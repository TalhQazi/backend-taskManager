const express = require("express");
const { z } = require("zod");

const Task = require("../models/Task");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const createSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().default(""),
  assignee: z.string().optional().default(""),
  location: z.string().optional().default(""),
  priority: z.enum(["high", "medium", "low"]).optional(),
  status: z.enum(["active", "pending", "completed"]).optional(),
  dueDate: z.union([z.string(), z.date()]).optional(),
});

const updateSchema = createSchema.partial();

function withId(doc) {
  if (!doc) return doc;
  return { ...doc, id: String(doc._id) };
}

router.get("/", requireAuth, async (_req, res, next) => {
  try {
    const items = await Task.find().sort({ createdAt: -1 }).lean();
    res.json({ items: items.map(withId) });
  } catch (err) {
    next(err);
  }
});

router.post("/", requireAuth, async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload" } });
    }

    const dueDate = parsed.data.dueDate ? new Date(parsed.data.dueDate) : undefined;

    const created = await Task.create({
      ...parsed.data,
      dueDate,
    });

    const obj = created.toObject();
    return res.status(201).json({ item: withId(obj) });
  } catch (err) {
    return next(err);
  }
});

router.put("/:id", requireAuth, async (req, res, next) => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload" } });
    }

    const patch = { ...parsed.data };
    if (patch.dueDate) {
      patch.dueDate = new Date(patch.dueDate);
    }

    const updated = await Task.findByIdAndUpdate(req.params.id, patch, {
      new: true,
    }).lean();

    if (!updated) {
      return res.status(404).json({ error: { message: "Task not found" } });
    }

    return res.json({ item: withId(updated) });
  } catch (err) {
    return next(err);
  }
});

router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const deleted = await Task.findByIdAndDelete(req.params.id).lean();
    if (!deleted) {
      return res.status(404).json({ error: { message: "Task not found" } });
    }
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
