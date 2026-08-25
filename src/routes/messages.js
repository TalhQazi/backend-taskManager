const express = require("express");
const mongoose = require("mongoose");
const { z } = require("zod");
const multer = require("multer");

const Message = require("../models/Message");
const ChatGroup = require("../models/ChatGroup");
const Employee = require("../models/Employee");
const Task = require("../models/Task");
const Settings = require("../models/Settings");
const { requireAuth } = require("../middleware/auth");
const { encrypt, decrypt } = require("../lib/encryption");
const { checkAndFlagOffTheClock } = require("../lib/offTheClockWork");
const { parsePagination, paginatedResponse } = require("../lib/pagination");
const { cacheWrap, cacheDel } = require("../lib/cache");
const { uploadToS3 } = require("../lib/s3");
const { createNotification } = require("../utils/notifications");
const { sendEmailNotification } = require("../utils/emailNotifications");

const router = express.Router();

function withId(doc) {
  if (!doc) return doc;
  return { ...doc, id: String(doc._id) };
}

function decryptOut(doc) {
  if (!doc) return doc;
  const next = { ...doc };
  try {
    if (typeof next.title === "string") next.title = decrypt(next.title);
  } catch (e) { /* keep original on decrypt failure */ }
  try {
    if (typeof next.content === "string") next.content = decrypt(next.content);
  } catch (e) { /* keep original on decrypt failure */ }
  return next;
}

const notificationSchema = z.object({
  title: z.string().min(1),
  message: z.string().min(1),
  audience: z.string().min(1),
  createdAt: z.string().optional(),
});

const attachmentSchema = z
  .object({
    fileName: z.string().optional().default(""),
    url: z.string().optional().default(""),
    mimeType: z.string().optional().default(""),
    size: z.coerce.number().optional().default(0),
  })
  .optional();

const createSchema = z.object({
  sender: z.string().min(1),
  senderAvatar: z.string().optional().default(""),
  recipient: z.string().optional().default(""),
  groupId: z.string().optional().nullable(),
  parentMessageId: z.string().optional().nullable(),
  content: z.string().optional().default(""),
  timestamp: z.string().min(1),
  type: z.enum(["direct", "broadcast", "group", "task_card", "voice_note", "system"]).optional().default("direct"),
  status: z.enum(["sent", "delivered", "read"]).optional(),
  attachment: attachmentSchema,
  attachments: z.array(attachmentSchema).optional().default([]),
  voiceNote: z.object({
    url: z.string().optional().default(""),
    duration: z.number().optional().default(0),
    waveform: z.array(z.number()).optional().default([]),
  }).optional(),
  taskCard: z.object({
    taskId: z.string().optional().default(""),
    title: z.string().optional().default(""),
    status: z.string().optional().default(""),
    priority: z.string().optional().default(""),
    dueDate: z.string().optional().default(""),
    assignees: z.array(z.string()).optional().default([]),
  }).optional(),
  mentions: z.array(z.object({
    username: z.string(),
    type: z.enum(["user", "department", "everyone"]).optional().default("user"),
  })).optional().default([]),
});

const updateSchema = createSchema.partial();

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB limit
});

router.post("/upload", requireAuth, upload.single("file"), async (req, res, next) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: { message: "No file provided" } });

    let url = "";
    try {
      url = await uploadToS3(file.buffer, file.originalname, file.mimetype, "messages");
    } catch (err) {
      const base64Data = file.buffer.toString("base64");
      url = `data:${file.mimetype};base64,${base64Data}`;
    }

    return res.json({
      attachment: {
        fileName: file.originalname,
        url,
        mimeType: file.mimetype,
        size: file.size,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Multi-file upload route (up to 10 files, max 25MB each)
router.post("/upload-multiple", requireAuth, upload.array("files", 10), async (req, res, next) => {
  try {
    const files = req.files;
    if (!files || files.length === 0) return res.status(400).json({ error: { message: "No files provided" } });

    const uploaded = await Promise.all(
      files.map(async (file) => {
        let url = "";
        try {
          url = await uploadToS3(file.buffer, file.originalname, file.mimetype, "messages");
        } catch (err) {
          const base64Data = file.buffer.toString("base64");
          url = `data:${file.mimetype};base64,${base64Data}`;
        }
        return {
          fileName: file.originalname,
          url,
          mimeType: file.mimetype,
          size: file.size,
        };
      })
    );

    return res.json({ attachments: uploaded });
  } catch (err) {
    next(err);
  }
});

// Unread broadcast notification count for the current user
router.get("/unread-count", requireAuth, async (req, res, next) => {
  try {
    const currentUser = String(req.user?.username || req.user?.name || "").trim();
    const currentName = String(req.user?.name || "").trim();
    const role = String(req.user?.role || "").trim();

    if (!currentUser) return res.json({ count: 0 });

    const query = {
      type: "broadcast",
      readBy: { $ne: currentUser },
      // Whitelist: only show notifications with a recognized category OR admin-created broadcasts
      $and: [{
        $or: [
          { "meta.category": { $in: ["TASK_ASSIGNED", "PROJECT_ASSIGNED", "TASK_COMPLETED", "MENTIONED", "COMMENT_ADDED", "SYSTEM_ALERT"] } },
          { audience: { $ne: "targeted" } },
        ],
      }],
    };

    if (role !== "super-admin") {
      const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\$&");
      // Include both email-based username AND display name so employees can find
      // notifications stored with their display name (from task.assignees).
      let candidates = [role, currentUser, currentName].filter(Boolean);
      if (role === "admin" || role === "manager") {
        candidates.push("admin", "manager");
      }
      candidates = [...new Set(candidates)];
      query.$and.push({
        $or: [
          ...candidates.map((c) => ({
            recipient: { $regex: new RegExp(`(^|,)${escapeRegex(c)}(,|$)`, "i") },
          })),
          { audience: { $ne: "targeted" } },
        ],
      });
    }

    const count = await Message.countDocuments(query);
    return res.json({ count });
  } catch (err) {
    next(err);
  }
});

// Get all messages (with optional filtering)
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const { sender, recipient, type, user } = req.query;
    const { page, limit, skip } = parsePagination(req.query);
    let query = {};

    // If 'user' param provided, get all messages where user is sender OR recipient
    if (user) {
      query = {
        $or: [
          { sender: user },
          { recipient: user }
        ],
        type: "direct"
      };
    } else {
      // Otherwise apply individual filters
      if (sender) query.sender = sender;
      if (type) query.type = type;

      if (recipient) {
        query.recipient = recipient;
      } else if (String(type || "").toLowerCase() === "broadcast") {
        const role = String(req.user?.role || "").trim();
        const username = String(req.user?.username || req.user?.name || "").trim();
        const displayName = String(req.user?.name || "").trim();
        const userId = String(req.user?.sub || req.user?.id || "").trim();

        query.type = "broadcast";
        // Whitelist: only show notifications with a recognized category OR admin-created broadcasts
        query.$and = [{
          $or: [
            { "meta.category": { $in: ["TASK_ASSIGNED", "PROJECT_ASSIGNED", "TASK_COMPLETED", "MENTIONED", "COMMENT_ADDED", "SYSTEM_ALERT"] } },
            { audience: { $ne: "targeted" } },
          ],
        }];

        if (role === "super-admin") {
          // super-admin sees all broadcast notifications
        } else {
          const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\$&");

          // Include both email-username AND display name. Employees have username=email
          // but task.assignees stores display names, so both must be searchable.
          let candidates = [role, username, displayName, userId].filter(Boolean);

          // Admin and manager can see each other's notifications
          if (role === "admin" || role === "manager") {
            candidates.push("admin");
            candidates.push("manager");
          }

          // Remove duplicates
          candidates = [...new Set(candidates)];

          query.$and.push({
            $or: [
              ...candidates.map((c) => ({
                recipient: { $regex: new RegExp(`(^|,)${escapeRegex(c)}(,|$)`, "i") },
              })),
              { audience: { $ne: "targeted" } },
            ],
          });
        }
      }
    }

    const cacheKey = `messages:list:${user || 'all'}:${sender || 'any'}:${recipient || 'any'}:${type || 'any'}:p${page}:l${limit}:${req.user?.sub || ''}`;
    
    const [items, total] = await Promise.all([
      Message.find(query).sort({ timestamp: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
      Message.countDocuments(query),
    ]);

    const currentUser = String(req.user?.username || req.user?.name || "").trim();
    const enriched = items.map((x) => {
      const doc = withId(decryptOut(x));
      const readByList = Array.isArray(x.readBy) ? x.readBy : [];
      const isReadByMe = currentUser && readByList.includes(currentUser);
      return { ...doc, status: isReadByMe ? "read" : "sent" };
    });

    const result = paginatedResponse(enriched, total, page, limit);

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Get conversation between two users
router.get("/conversation/:user1/:user2", requireAuth, async (req, res, next) => {
  try {
    const { user1, user2 } = req.params;

    const items = await Message.find({
      type: "direct",
      $or: [
        { sender: user1, recipient: user2 },
        { sender: user2, recipient: user1 }
      ]
    }).sort({ _id: 1 }).lean();

    res.json({ items: items.map((x) => withId(decryptOut(x))) });
  } catch (err) {
    next(err);
  }
});

// Get conversations list for a user (with last message and unread count)
router.get("/conversations/:user", requireAuth, async (req, res, next) => {
  try {
    const { user } = req.params;

    // Get all direct messages where user is sender or recipient
    const messages = await Message.find({
      type: "direct",
      $or: [
        { sender: user },
        { recipient: user }
      ]
    }).sort({ timestamp: -1 }).lean();

    // Get all employees for reference
    const employees = await Employee.find().lean();

    // Resolve profile picture URLs from Settings keyed by Employee._id
    const empIds = employees.map((e) => String(e._id));
    const settingsList = empIds.length
      ? await Settings.find({ userId: { $in: empIds } })
          .select("userId avatarUrl avatarDataUrl")
          .lean()
      : [];
    const idToAvatar = new Map(
      settingsList.map((s) => [String(s.userId), String(s.avatarDataUrl || s.avatarUrl || "").trim()])
    );

    // Group by conversation partner
    const conversationMap = new Map();

    // Initialize with all active employees
    employees.forEach((emp) => {
      if (emp.name !== user) {
        const avatarUrl = idToAvatar.get(String(emp._id)) || "";
        conversationMap.set(emp.name, {
          employee: {
            id: String(emp._id),
            name: emp.name,
            email: emp.email,
            department: emp.department || "",
            status: emp.status || "active",
            initials: emp.initials || emp.name.split(" ").map(n => n[0]).slice(0, 2).join("").toUpperCase(),
            avatarUrl: avatarUrl || undefined,
            current_status: emp.current_status || "AVAILABLE",
            lunch_start_time: emp.lunch_start_time || null,
            lunch_expected_end: emp.lunch_expected_end || null,
            break_start_time: emp.break_start_time || null
          },
          lastMessage: null,
          unreadCount: 0
        });
      }
    });

    // Process messages
    messages.forEach((msg) => {
      const isSentByUser = msg.sender === user;
      const otherPerson = isSentByUser ? msg.recipient : msg.sender;

      if (!conversationMap.has(otherPerson)) {
        // Create entry for unknown person (not in employees list)
        conversationMap.set(otherPerson, {
          employee: {
            id: otherPerson,
            name: otherPerson,
            email: "",
            department: "",
            status: "active",
            initials: otherPerson.split(" ").map(n => n[0]).slice(0, 2).join("").toUpperCase()
          },
          lastMessage: null,
          unreadCount: 0
        });
      }

      const conv = conversationMap.get(otherPerson);

      // Update last message if this is newer
      if (!conv.lastMessage || new Date(msg.timestamp) > new Date(conv.lastMessage.timestamp)) {
        conv.lastMessage = withId(decryptOut(msg));
      }

      // Count unread messages (not sent by user and not read)
      if (!isSentByUser && msg.status !== "read") {
        conv.unreadCount++;
      }
    });

    // Convert to array and sort by last message time
    const conversations = Array.from(conversationMap.values())
      .filter((conv) => conv.lastMessage !== null || conv.employee.status === "active")
      .sort((a, b) => {
        if (!a.lastMessage && !b.lastMessage) return 0;
        if (!a.lastMessage) return 1;
        if (!b.lastMessage) return -1;
        return new Date(b.lastMessage.timestamp) - new Date(a.lastMessage.timestamp);
      });

    res.json({ items: conversations });
  } catch (err) {
    next(err);
  }
});

// Mark messages as read
router.post("/mark-read", requireAuth, async (req, res, next) => {
  try {
    const schema = z.object({
      sender: z.string().min(1),
      recipient: z.string().min(1)
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload" } });
    }

    const { sender, recipient } = parsed.data;

   
    await Message.updateMany(
      {
        sender: sender,
        recipient: recipient,
        status: { $ne: "read" }
      },
      { $set: { status: "read" } }
    );

    // Invalidate message caches
    await cacheDel("messages:list:*").catch(() => {});

    res.json({ success: true, message: "Messages marked as read" });
  } catch (err) {
    next(err);
  }
});


router.post("/", requireAuth, async (req, res, next) => {
  try {
    const notificationParsed = notificationSchema.safeParse(req.body);
    if (notificationParsed.success) {
      const now = new Date();
      const created = await Message.create({
        title: encrypt(notificationParsed.data.title),
        audience: notificationParsed.data.audience,
        createdAt: notificationParsed.data.createdAt || now.toISOString().split("T")[0],
        sender: "system",
        senderAvatar: "",
        recipient: notificationParsed.data.audience,
        content: encrypt(notificationParsed.data.message),
        timestamp: now.toISOString(),
        type: "broadcast",
        status: "sent",
      });
     const io = global.io;
  
     const finalData = withId(decryptOut(created.toObject()));

    
      if (io) {
        io.emit("new-notification", {
          ...finalData,
          message: finalData.content || finalData.message, 
          type: "task", 
        });
      }

      return res.status(201).json({ item: finalData });

     //return res.status(201).json({ item: withId(decryptOut(created.toObject())) });
    }

    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { message: "Invalid payload" } });

    const content = String(parsed.data.content || "");
    const hasAttachment =
      !!parsed.data.attachment &&
      typeof parsed.data.attachment.url === "string" &&
      parsed.data.attachment.url.trim().length > 0;
    const hasAttachments =
      Array.isArray(parsed.data.attachments) &&
      parsed.data.attachments.length > 0 &&
      parsed.data.attachments.some((a) => a && a.url);
    const hasVoiceNote =
      !!parsed.data.voiceNote &&
      typeof parsed.data.voiceNote.url === "string" &&
      parsed.data.voiceNote.url.trim().length > 0;

    if (!content.trim() && !hasAttachment && !hasAttachments && !hasVoiceNote) {
      return res.status(400).json({ error: { message: "Message content, attachment, or voice note is required" } });
    }

    const validGroupId = (parsed.data.groupId && mongoose.Types.ObjectId.isValid(parsed.data.groupId))
      ? parsed.data.groupId
      : undefined;
    const validParentId = (parsed.data.parentMessageId && mongoose.Types.ObjectId.isValid(parsed.data.parentMessageId))
      ? parsed.data.parentMessageId
      : undefined;

    const created = await Message.create({
      ...parsed.data,
      title: typeof parsed.data.title === "string" ? encrypt(parsed.data.title) : "",
      content: encrypt(content),
      attachment: parsed.data.attachment || undefined,
      groupId: validGroupId,
      parentMessageId: validParentId,
    });

    const finalData = withId(decryptOut(created.toObject()));
    const io = global.io;

    // Update group timestamp if it's a group message
    if (validGroupId) {
      ChatGroup.findByIdAndUpdate(validGroupId, { updatedAt: new Date() }).catch(() => {});
    }

    // Notify the recipient(s) of a direct message so offline users still get an
    // in-app notification (persists + real-time) and an email.
    const recipients = parsed.data.type === "direct"
      ? String(parsed.data.recipient || "")
          .split(",")
          .map((r) => r.trim())
          .filter((r) => r && r.toLowerCase() !== String(parsed.data.sender || "").toLowerCase())
      : [];

    const preview = content.trim()
      ? (content.trim().length > 60 ? content.trim().slice(0, 60) + "…" : content.trim())
      : (hasAttachment ? "Sent an attachment" : (hasVoiceNote ? "Sent a voice note" : ""));

    // Fire-and-forget side effects
    Promise.allSettled([
      checkAndFlagOffTheClock({
        employee: parsed.data.sender,
        userId: String(req.user?.sub || ""),
        timestamp: parsed.data.timestamp,
        activityType: "message_create",
        metadata: { recipient: parsed.data.recipient, type: parsed.data.type },
      }),
      cacheDel("messages:list:*"),
      // In-app notification (targets sender + recipient only, private to them)
      ...(recipients.length > 0 ? [createNotification({
        actor: parsed.data.sender,
        actorRole: String(req.user?.role || ""),
        action: "messaged you",
        resourceType: "",
        resourceName: "",
        assignees: recipients,
        details: preview,
        category: "MENTIONED",
      })] : []),
      // Email notification (skips gracefully if template/SMTP not configured or user opted out)
      ...recipients.map((r) => sendEmailNotification(r, "newMessage", {
        senderName: parsed.data.sender,
        messagePreview: preview || "You have a new message.",
      })),
    ]).catch(() => {});

    if (io) {
      if (validGroupId) {
        io.to(`group-${validGroupId}`).emit("new-message", finalData);
      }
      io.emit("new-message", finalData);
    }

    return res.status(201).json({ item: finalData });

  } catch (err) {
    next(err);
  }
});

// Toggle the current user's emoji reaction on a message.
// Adding the same emoji twice removes it (Slack-style, multiple emojis allowed per user).
router.post("/:id/react", requireAuth, async (req, res, next) => {
  try {
    const schema = z.object({
      emoji: z.string().min(1).max(16),
      // Display name of the reacting user (sockets and messages are keyed by display name)
      username: z.string().min(1).max(120).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { message: "Invalid payload" } });

    const username = String(
      parsed.data.username || req.user?.name || req.user?.username || ""
    ).trim();
    if (!username) return res.status(400).json({ error: { message: "Cannot identify user" } });

    const message = await Message.findById(req.params.id);
    if (!message) return res.status(404).json({ error: { message: "Message not found" } });

    const { emoji } = parsed.data;
    const existingIdx = (message.reactions || []).findIndex(
      (r) => r.emoji === emoji && r.username === username
    );
    if (existingIdx >= 0) {
      message.reactions.splice(existingIdx, 1);
    } else {
      message.reactions.push({ emoji, username });
    }
    await message.save();

    const reactions = message.reactions.map((r) => ({ emoji: r.emoji, username: r.username }));
    const io = global.io;
    if (io) {
      io.emit("message-reaction", { messageId: String(message._id), reactions });
    }

    return res.json({ messageId: String(message._id), reactions });
  } catch (err) {
    next(err);
  }
});

// Mark a single broadcast notification as read for the current user
router.post("/:id/mark-read", requireAuth, async (req, res, next) => {
  try {
    const currentUser = String(req.user?.username || req.user?.name || "").trim();
    if (!currentUser) return res.status(400).json({ error: { message: "Cannot identify user" } });

    await Message.findByIdAndUpdate(req.params.id, {
      $addToSet: { readBy: currentUser },
    });

    // Invalidate message caches
    await cacheDel("messages:list:*").catch(() => {});

    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Mark all unread broadcast notifications as read for the current user
router.post("/mark-all-read", requireAuth, async (req, res, next) => {
  try {
    const role = String(req.user?.role || "").trim();
    const currentUser = String(req.user?.username || req.user?.name || "").trim();
    const currentName = String(req.user?.name || "").trim();
    if (!currentUser) return res.status(400).json({ error: { message: "Cannot identify user" } });

    let query = {
      type: "broadcast",
      // Whitelist: only mark-read notifications with a recognized category OR admin-created broadcasts
      $and: [{
        $or: [
          { "meta.category": { $in: ["TASK_ASSIGNED", "PROJECT_ASSIGNED", "TASK_COMPLETED", "MENTIONED", "COMMENT_ADDED", "SYSTEM_ALERT"] } },
          { audience: { $ne: "targeted" } },
        ],
      }],
    };
    if (role !== "super-admin") {
      const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\$&");

      let candidates = [role, currentUser, currentName].filter(Boolean);

      if (role === "admin" || role === "manager") {
        candidates.push("admin");
        candidates.push("manager");
      }

      candidates = [...new Set(candidates)];

      query.$and.push({
        $or: [
          ...candidates.map((c) => ({
            recipient: { $regex: new RegExp(`(^|,)${escapeRegex(c)}(,|$)`, "i") },
          })),
          { audience: { $ne: "targeted" } },
        ],
      });
    }

    await Message.updateMany(
      { ...query, readBy: { $ne: currentUser } },
      { $addToSet: { readBy: currentUser } }
    );

    // Invalidate message caches
    await cacheDel("messages:list:*").catch(() => {});

    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Update message
router.put("/:id", requireAuth, async (req, res, next) => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { message: "Invalid payload" } });

    if (typeof parsed.data.sender === "string" || typeof parsed.data.timestamp === "string") {
      await checkAndFlagOffTheClock({
        employee: parsed.data.sender,
        userId: String(req.user?.sub || ""),
        timestamp: parsed.data.timestamp || new Date(),
        activityType: "message_update",
        metadata: { messageId: req.params.id },
      });
    }

    const patch = { ...parsed.data };
    if (typeof patch.title === "string") patch.title = encrypt(patch.title);
    if (typeof patch.content === "string") patch.content = encrypt(patch.content);

    const updated = await Message.findByIdAndUpdate(req.params.id, patch, { new: true }).lean();
    if (!updated) return res.status(404).json({ error: { message: "Message not found" } });

    res.json({ item: withId(decryptOut(updated)) });
  } catch (err) {
    next(err);
  }
});

// Delete message
router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const deleted = await Message.findByIdAndDelete(req.params.id).lean();
    if (!deleted) return res.status(404).json({ error: { message: "Message not found" } });
    
    await cacheDel("messages:list:*").catch(() => {});
    
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// ENTERPRISE GROUP CHAT ENDPOINTS
// ---------------------------------------------------------------------------

// Create a new Chat Group (Restricted to Super Admin & Admin)
router.post("/groups", requireAuth, async (req, res, next) => {
  try {
    const role = String(req.user?.role || "").trim().toLowerCase();
    if (!["super-admin", "admin"].includes(role)) {
      return res.status(403).json({ error: { message: "Only Admins and Super Admins can create groups" } });
    }

    const schema = z.object({
      name: z.string().min(1),
      description: z.string().optional().default(""),
      avatarUrl: z.string().optional().default(""),
      groupType: z.enum(["custom", "department", "project", "task"]).optional().default("custom"),
      isPrivate: z.boolean().optional().default(false),
      announcementOnly: z.boolean().optional().default(false),
      members: z.array(z.string()).min(1),
      department: z.string().optional().default(""),
      projectId: z.string().optional().nullable(),
      taskId: z.string().optional().nullable(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { message: "Invalid group payload" } });

    const currentUser = String(req.user?.name || req.user?.username || "Admin").trim();
    const membersList = [...new Set([currentUser, ...parsed.data.members])];

    const group = await ChatGroup.create({
      ...parsed.data,
      createdBy: currentUser,
      creatorRole: role,
      members: membersList,
      admins: [currentUser],
    });

    const io = global.io;
    if (io) {
      membersList.forEach((m) => io.to(m).emit("new-group-created", withId(group.toObject())));
    }

    return res.status(201).json({ item: withId(group.toObject()) });
  } catch (err) {
    next(err);
  }
});

// List Groups for current user
router.get("/groups", requireAuth, async (req, res, next) => {
  try {
    const currentUser = String(req.user?.name || req.user?.username || "").trim();
    const groups = await ChatGroup.find({
      members: currentUser,
      isArchived: false,
    }).sort({ updatedAt: -1 }).lean();

    return res.json({ items: groups.map(withId) });
  } catch (err) {
    next(err);
  }
});

// Get single group details with members
router.get("/groups/:id", requireAuth, async (req, res, next) => {
  try {
    const group = await ChatGroup.findById(req.params.id).lean();
    if (!group) return res.status(404).json({ error: { message: "Group not found" } });
    return res.json({ item: withId(group) });
  } catch (err) {
    next(err);
  }
});

// Get Group Messages with pagination
router.get("/groups/:id/messages", requireAuth, async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const messages = await Message.find({
      groupId: req.params.id,
      parentMessageId: null, // main channel messages only
    })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await Message.countDocuments({ groupId: req.params.id, parentMessageId: null });
    const enriched = messages.reverse().map((x) => withId(decryptOut(x)));

    return res.json(paginatedResponse(enriched, total, page, limit));
  } catch (err) {
    next(err);
  }
});

// Update group settings / announcement mode
router.put("/groups/:id", requireAuth, async (req, res, next) => {
  try {
    const group = await ChatGroup.findById(req.params.id);
    if (!group) return res.status(404).json({ error: { message: "Group not found" } });

    const currentUser = String(req.user?.name || req.user?.username || "").trim();
    const role = String(req.user?.role || "").trim().toLowerCase();
    const isGroupAdmin = group.admins.includes(currentUser) || ["super-admin", "admin"].includes(role);

    if (!isGroupAdmin) {
      return res.status(403).json({ error: { message: "Forbidden: Only Group Admins can modify settings" } });
    }

    const { name, description, avatarUrl, announcementOnly, isPrivate } = req.body;
    if (name) group.name = name;
    if (description !== undefined) group.description = description;
    if (avatarUrl !== undefined) group.avatarUrl = avatarUrl;
    if (announcementOnly !== undefined) group.announcementOnly = announcementOnly;
    if (isPrivate !== undefined) group.isPrivate = isPrivate;

    await group.save();
    return res.json({ item: withId(group.toObject()) });
  } catch (err) {
    next(err);
  }
});

// Add / Remove group members
router.post("/groups/:id/members", requireAuth, async (req, res, next) => {
  try {
    const { action, memberName } = req.body;
    if (!memberName) return res.status(400).json({ error: { message: "memberName required" } });

    const group = await ChatGroup.findById(req.params.id);
    if (!group) return res.status(404).json({ error: { message: "Group not found" } });

    if (action === "add") {
      if (!group.members.includes(memberName)) group.members.push(memberName);
    } else if (action === "remove") {
      group.members = group.members.filter((m) => m !== memberName);
      group.admins = group.admins.filter((a) => a !== memberName);
    }

    await group.save();
    return res.json({ item: withId(group.toObject()) });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// THREADS, CONVERT-TO-TASK, PINS, STARS, & MEDIA VAULT ENDPOINTS
// ---------------------------------------------------------------------------

// Get thread replies for a message
router.get("/:id/thread", requireAuth, async (req, res, next) => {
  try {
    const replies = await Message.find({ parentMessageId: req.params.id })
      .sort({ createdAt: 1 })
      .lean();
    return res.json({ items: replies.map((r) => withId(decryptOut(r))) });
  } catch (err) {
    next(err);
  }
});

// Post a reply to a thread
router.post("/:id/reply", requireAuth, async (req, res, next) => {
  try {
    const parent = await Message.findById(req.params.id);
    if (!parent) return res.status(404).json({ error: { message: "Parent message not found" } });

    const { content, sender, attachments } = req.body;
    const reply = await Message.create({
      sender: sender || req.user?.name || "User",
      recipient: parent.recipient,
      groupId: parent.groupId,
      parentMessageId: parent._id,
      content: encrypt(content || ""),
      timestamp: new Date().toISOString(),
      type: parent.type,
      attachments: attachments || [],
    });

    parent.replyCount = (parent.replyCount || 0) + 1;
    parent.lastReplyAt = new Date();
    await parent.save();

    const finalData = withId(decryptOut(reply.toObject()));
    const io = global.io;
    if (io) {
      if (parent.groupId) {
        io.to(`group-${parent.groupId}`).emit("thread-reply", { parentId: String(parent._id), reply: finalData });
      } else {
        io.to(parent.sender).to(parent.recipient).emit("thread-reply", { parentId: String(parent._id), reply: finalData });
      }
    }

    return res.status(201).json({ item: finalData });
  } catch (err) {
    next(err);
  }
});

// Pin / Unpin message
router.post("/:id/pin", requireAuth, async (req, res, next) => {
  try {
    const message = await Message.findById(req.params.id);
    if (!message) return res.status(404).json({ error: { message: "Message not found" } });

    const currentUser = String(req.user?.name || req.user?.username || "").trim();
    message.isPinned = !message.isPinned;
    message.pinnedBy = message.isPinned ? currentUser : "";
    await message.save();

    return res.json({ item: withId(decryptOut(message.toObject())) });
  } catch (err) {
    next(err);
  }
});

// Star / Unstar message
router.post("/:id/star", requireAuth, async (req, res, next) => {
  try {
    const message = await Message.findById(req.params.id);
    if (!message) return res.status(404).json({ error: { message: "Message not found" } });

    const currentUser = String(req.user?.name || req.user?.username || "").trim();
    const idx = (message.starredBy || []).indexOf(currentUser);
    if (idx >= 0) {
      message.starredBy.splice(idx, 1);
    } else {
      message.starredBy.push(currentUser);
    }
    await message.save();

    return res.json({ item: withId(decryptOut(message.toObject())) });
  } catch (err) {
    next(err);
  }
});

// Convert Message to Task (1-Click)
router.post("/:id/convert-to-task", requireAuth, async (req, res, next) => {
  try {
    const message = await Message.findById(req.params.id);
    if (!message) return res.status(404).json({ error: { message: "Message not found" } });

    const decContent = decryptOut(message.toObject()).content || "Task from Chat";
    const title = decContent.length > 50 ? decContent.slice(0, 50) + "..." : decContent;

    const newTask = await Task.create({
      title: title || "Task from Message",
      description: decContent,
      priority: req.body.priority || "medium",
      status: "pending",
      assignees: req.body.assignees || [message.sender],
      createdBy: {
        userId: String(req.user?.sub || req.user?.id || ""),
        name: String(req.user?.name || "Admin"),
        email: String(req.user?.email || ""),
        role: String(req.user?.role || "admin"),
      },
    });

    return res.status(201).json({ item: newTask, message: "Task created successfully from message" });
  } catch (err) {
    next(err);
  }
});

// Shared Media Vault
router.get("/media-vault", requireAuth, async (req, res, next) => {
  try {
    const { groupId, recipient } = req.query;
    const mediaFilter = {
      $or: [
        { "attachment.url": { $exists: true, $nin: ["", null] } },
        { "attachments.0.url": { $exists: true, $nin: ["", null] } },
        { "voiceNote.url": { $exists: true, $nin: ["", null] } },
      ],
    };

    let query = {};
    if (groupId) {
      query = {
        groupId,
        ...mediaFilter,
      };
    } else if (recipient) {
      const currentUser = String(req.user?.name || req.user?.username || "").trim();
      query = {
        type: "direct",
        $and: [
          {
            $or: [
              { sender: currentUser, recipient },
              { sender: recipient, recipient: currentUser },
            ],
          },
          mediaFilter,
        ],
      };
    } else {
      query = mediaFilter;
    }

    const messages = await Message.find(query).sort({ createdAt: -1 }).limit(100).lean();
    return res.json({ items: messages.map((m) => withId(decryptOut(m))) });
  } catch (err) {
    next(err);
  }
});

// Global Search across Messages
router.get("/search", requireAuth, async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.json({ items: [] });

    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const currentUser = String(req.user?.name || req.user?.username || "").trim();

    const myGroups = await ChatGroup.find({ members: currentUser }).select("_id").lean();
    const groupIds = myGroups.map((g) => g._id);

    const messages = await Message.find({
      $or: [
        { sender: currentUser },
        { recipient: currentUser },
        { groupId: { $in: groupIds } },
      ],
      content: { $regex: rx },
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    return res.json({ items: messages.map((m) => withId(decryptOut(m))) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
