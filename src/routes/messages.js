const express = require("express");
const { z } = require("zod");
const multer = require("multer");

const Message = require("../models/Message");
const Employee = require("../models/Employee");
const { requireAuth } = require("../middleware/auth");
const { encrypt, decrypt } = require("../lib/encryption");
const { checkAndFlagOffTheClock } = require("../lib/offTheClockWork");
const { parsePagination, paginatedResponse } = require("../lib/pagination");
const { cacheWrap, cacheDel } = require("../lib/cache");
const { uploadToS3 } = require("../lib/s3");

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
  recipient: z.string().min(1),
  content: z.string().optional().default(""),
  timestamp: z.string().min(1),
  type: z.enum(["direct", "broadcast"]),
  status: z.enum(["sent", "delivered", "read"]).optional(),
  attachment: attachmentSchema,
});

const updateSchema = createSchema.partial();

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 16 * 1024 * 1024 },
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
      const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Include both email-based username AND display name so employees can find
      // notifications stored with their display name (from task.assignees).
      let candidates = [role, currentUser, currentName].filter(Boolean);
      if (role === "admin" || role === "manager") {
        candidates.push("admin", "manager");
      }
      candidates = [...new Set(candidates)];
      query.$and.push({
        $or: candidates.map((c) => ({
          recipient: { $regex: new RegExp(`(^|,)${escapeRegex(c)}(,|$)`, "i") },
        })),
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
          const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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
            $or: candidates.map((c) => ({
              recipient: { $regex: new RegExp(`(^|,)${escapeRegex(c)}(,|$)`, "i") }
            })),
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
    }).sort({ timestamp: 1 }).lean();

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

    // Group by conversation partner
    const conversationMap = new Map();

    // Initialize with all active employees
    employees.forEach((emp) => {
      if (emp.name !== user) {
        conversationMap.set(emp.name, {
          employee: {
            id: String(emp._id),
            name: emp.name,
            email: emp.email,
            department: emp.department || "",
            status: emp.status || "active",
            initials: emp.initials || emp.name.split(" ").map(n => n[0]).slice(0, 2).join("").toUpperCase()
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

    if (!content.trim() && !hasAttachment) {
      return res.status(400).json({ error: { message: "Message content or attachment is required" } });
    }

    const created = await Message.create({
      ...parsed.data,
      title: typeof parsed.data.title === "string" ? encrypt(parsed.data.title) : "",
      content: encrypt(content),
      attachment: parsed.data.attachment || undefined,
    });

    const finalData = withId(decryptOut(created.toObject()));
    const io = global.io;

    // Fire-and-forget side effects
    Promise.allSettled([
      checkAndFlagOffTheClock({
        employee: parsed.data.sender,
        userId: String(req.user?.sub || ""),
        timestamp: parsed.data.timestamp,
        activityType: "message_create",
        metadata: { recipient: parsed.data.recipient, type: parsed.data.type },
      }),
      cacheDel("messages:list:*")
    ]).catch(() => {});

    if (io) {
      io.emit("new-message", finalData);
    }

    return res.status(201).json({ item: finalData });

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
      const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      let candidates = [role, currentUser, currentName].filter(Boolean);

      if (role === "admin" || role === "manager") {
        candidates.push("admin");
        candidates.push("manager");
      }

      candidates = [...new Set(candidates)];

      query.$and.push({
        $or: candidates.map((c) => ({
          recipient: { $regex: new RegExp(`(^|,)${escapeRegex(c)}(,|$)`, "i") }
        })),
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

module.exports = router;
