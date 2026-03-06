const express = require("express");
const { z } = require("zod");

const Message = require("../models/Message");
const Employee = require("../models/Employee");
const { requireAuth } = require("../middleware/auth");
const { encryptString, decryptString } = require("../lib/encryption");
const { checkAndFlagOffTheClock } = require("../lib/offTheClockWork");

const router = express.Router();

function withId(doc) {
  if (!doc) return doc;
  return { ...doc, id: String(doc._id) };
}

function decryptOut(doc) {
  if (!doc) return doc;
  const next = { ...doc };
  if (typeof next.title === "string") next.title = decryptString(next.title);
  if (typeof next.content === "string") next.content = decryptString(next.content);
  return next;
}

const notificationSchema = z.object({
  title: z.string().min(1),
  message: z.string().min(1),
  audience: z.string().min(1),
  createdAt: z.string().optional(),
});

const createSchema = z.object({
  sender: z.string().min(1),
  senderAvatar: z.string().optional().default(""),
  recipient: z.string().min(1),
  content: z.string().min(1),
  timestamp: z.string().min(1),
  type: z.enum(["direct", "broadcast"]),
  status: z.enum(["sent", "delivered", "read"]).optional(),
});

const updateSchema = createSchema.partial();

// Get all messages (with optional filtering)
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const { sender, recipient, type, user } = req.query;
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
      if (recipient) query.recipient = recipient;
      if (type) query.type = type;
    }

    const items = await Message.find(query).sort({ createdAt: -1 }).lean();
    res.json({ items: items.map((x) => withId(decryptOut(x))) });
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

    // Mark all messages from sender to recipient as read
    await Message.updateMany(
      {
        sender: sender,
        recipient: recipient,
        status: { $ne: "read" }
      },
      { $set: { status: "read" } }
    );

    res.json({ success: true, message: "Messages marked as read" });
  } catch (err) {
    next(err);
  }
});

// Create new message
router.post("/", requireAuth, async (req, res, next) => {
  try {
    const notificationParsed = notificationSchema.safeParse(req.body);
    if (notificationParsed.success) {
      const now = new Date();
      const created = await Message.create({
        title: encryptString(notificationParsed.data.title),
        audience: notificationParsed.data.audience,
        createdAt: notificationParsed.data.createdAt || now.toISOString().split("T")[0],
        sender: "system",
        senderAvatar: "",
        recipient: notificationParsed.data.audience,
        content: encryptString(notificationParsed.data.message),
        timestamp: now.toISOString(),
        type: "broadcast",
        status: "sent",
      });
      return res.status(201).json({ item: withId(decryptOut(created.toObject())) });
    }

    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { message: "Invalid payload" } });

    await checkAndFlagOffTheClock({
      employee: parsed.data.sender,
      userId: String(req.user?.sub || ""),
      timestamp: parsed.data.timestamp,
      activityType: "message_create",
      metadata: { recipient: parsed.data.recipient, type: parsed.data.type },
    });

    const created = await Message.create({
      ...parsed.data,
      title: typeof parsed.data.title === "string" ? encryptString(parsed.data.title) : "",
      content: encryptString(parsed.data.content),
    });
    return res.status(201).json({ item: withId(decryptOut(created.toObject())) });
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
        metadata: { messageId: String(req.params.id) },
      });
    }

    const patch = { ...parsed.data };
    if (typeof patch.title === "string") patch.title = encryptString(patch.title);
    if (typeof patch.content === "string") patch.content = encryptString(patch.content);

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
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
