const express = require("express");

const BugReport = require("../models/BugReport");
const Task = require("../models/Task");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

function withId(doc) {
  if (!doc) return doc;
  return { ...doc, id: String(doc._id) };
}

router.post("/", requireAuth, async (req, res, next) => {
  try {
    const taskId = String(req.body?.taskId || "").trim();
    const title = String(req.body?.title || "").trim();
    const description = String(req.body?.description || "").trim();
    const attachment = req.body?.attachment && typeof req.body.attachment === "object" ? req.body.attachment : null;

    if (!taskId) return res.status(400).json({ error: { message: "taskId is required" } });
    if (!title) return res.status(400).json({ error: { message: "Bug title is required" } });
    if (!description) return res.status(400).json({ error: { message: "Bug description is required" } });

    const task = await Task.findById(taskId).lean();
    if (!task) return res.status(404).json({ error: { message: "Task not found" } });

    const created = await BugReport.create({
      taskId,
      taskTitle: String(task.title || ""),
      title,
      description,
      attachment: attachment
        ? {
            fileName: String(attachment.fileName || ""),
            url: String(attachment.url || ""),
            mimeType: String(attachment.mimeType || ""),
            size: Number(attachment.size || 0),
          }
        : undefined,
      createdByUserId: String(req.user?.sub || req.user?.id || ""),
      createdByUsername: String(req.user?.username || req.user?.name || ""),
      createdByRole: String(req.user?.role || ""),
    });

    return res.status(201).json({ item: withId(created.toObject()) });
  } catch (err) {
    return next(err);
  }
});

router.get("/", requireAuth, async (_req, res, next) => {
  try {
    const items = await BugReport.find().sort({ createdAt: -1 }).lean();
    res.json({ items: items.map(withId) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
