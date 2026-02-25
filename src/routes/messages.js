const express = require("express");
const { z } = require("zod");

const Message = require("../models/Message");
const { requireAuth } = require("../middleware/auth");
const { encryptString, decryptString } = require("../lib/encryption");

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

router.get("/", requireAuth, async (_req, res, next) => {
  try {
    const items = await Message.find().sort({ createdAt: -1 }).lean();
    res.json({ items: items.map((x) => withId(decryptOut(x))) });
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

router.put("/:id", requireAuth, async (req, res, next) => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { message: "Invalid payload" } });

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
