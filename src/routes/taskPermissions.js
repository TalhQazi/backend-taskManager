const express = require("express");
const mongoose = require("mongoose");
const { z } = require("zod");

const TaskPermission = require("../models/TaskPermission");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

function withId(doc) {
  if (!doc) return doc;
  return { ...doc, id: String(doc._id) };
}

const upsertSchema = z.object({
  taskId: z.string().min(1),
  canReassign: z.boolean(),
});

// Admin-only: list task permissions
router.get("/", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const taskId = String(req.query.taskId || "").trim();
    const filter = taskId && mongoose.Types.ObjectId.isValid(taskId) ? { taskId } : {};
    const items = await TaskPermission.find(filter).sort({ createdAt: -1 }).lean();
    res.json({ items: items.map(withId) });
  } catch (err) {
    next(err);
  }
});

// Admin-only: upsert task permission
router.post("/", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const parsed = upsertSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload", details: parsed.error.errors } });
    }

    const { taskId, canReassign } = parsed.data;
    if (!mongoose.Types.ObjectId.isValid(taskId)) {
      return res.status(400).json({ error: { message: "Invalid taskId" } });
    }

    const doc = await TaskPermission.findOneAndUpdate(
      { taskId },
      { $set: { taskId, canReassign } },
      { new: true, upsert: true, runValidators: true }
    ).lean();

    res.status(201).json({ item: withId(doc) });
  } catch (err) {
    next(err);
  }
});

// Admin-only: delete task permission
router.delete("/", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const taskId = String(req.query.taskId || "").trim();
    if (!taskId) {
      return res.status(400).json({ error: { message: "taskId query param is required" } });
    }
    if (!mongoose.Types.ObjectId.isValid(taskId)) {
      return res.status(400).json({ error: { message: "Invalid taskId" } });
    }

    await TaskPermission.deleteOne({ taskId });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
