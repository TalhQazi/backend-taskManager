const express = require("express");
const { z } = require("zod");

const CRMCommunication = require("../models/CRMCommunication");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const createSchema = z.object({
  type: z.enum(["Email", "SMS", "Call", "Note"]),
  sender: z.string().min(1, "Sender is required"),
  receiver: z.string().min(1, "Receiver is required"),
  content: z.string().min(1, "Content is required"),
  status: z.string().min(1, "Status is required"),
  date: z.string().optional(),
});

const updateSchema = createSchema.partial();

function withId(doc) {
  if (!doc) return doc;
  const obj = doc.toObject ? doc.toObject() : doc;
  const { _id, __v, ...rest } = obj;
  return { ...rest, id: String(_id) };
}

router.get("/", requireAuth, async (req, res, next) => {
  try {
    const { search, type } = req.query;
    const query = {};

    if (type && type !== "All") {
      query.type = String(type);
    }

    if (search) {
      const regex = new RegExp(String(search), "i");
      query.$or = [
        { sender: regex },
        { receiver: regex },
        { content: regex },
        { status: regex },
      ];
    }

    const items = await CRMCommunication.find(query).sort({ date: -1 }).lean();
    res.json({ items: items.map(withId) });
  } catch (err) {
    next(err);
  }
});

router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const item = await CRMCommunication.findById(req.params.id).lean();
    if (!item) {
      return res.status(404).json({ error: { message: "Communication record not found" } });
    }
    res.json({ item: withId(item) });
  } catch (err) {
    next(err);
  }
});

router.post("/", requireAuth, async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: parsed.error.errors[0]?.message || "Invalid payload" } });
    }

    const created = await CRMCommunication.create({
      type: parsed.data.type,
      sender: parsed.data.sender,
      receiver: parsed.data.receiver,
      content: parsed.data.content,
      status: parsed.data.status,
      date: parsed.data.date ? new Date(parsed.data.date) : new Date(),
      createdBy: req.user?.id,
    });

    res.status(201).json({ item: withId(created) });
  } catch (err) {
    next(err);
  }
});

router.put("/:id", requireAuth, async (req, res, next) => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: parsed.error.errors[0]?.message || "Invalid payload" } });
    }

    const updated = await CRMCommunication.findByIdAndUpdate(
      req.params.id,
      { ...parsed.data, updatedBy: req.user?.id },
      { new: true }
    ).lean();

    if (!updated) {
      return res.status(404).json({ error: { message: "Communication record not found" } });
    }

    res.json({ item: withId(updated) });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const deleted = await CRMCommunication.findByIdAndDelete(req.params.id).lean();
    if (!deleted) {
      return res.status(404).json({ error: { message: "Communication record not found" } });
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
