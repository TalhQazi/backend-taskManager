const express = require("express");

const BugReport = require("../models/BugReport");
const Task = require("../models/Task");
const { requireAuth } = require("../middleware/auth");
const { createNotification } = require("../utils/notifications");

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
    const attachmentsRaw = Array.isArray(req.body?.attachments) ? req.body.attachments : [];
    const sourceRaw = req.body?.source && typeof req.body.source === "object" ? req.body.source : null;

    if (!title) return res.status(400).json({ error: { message: "Bug title is required" } });
    if (!description) return res.status(400).json({ error: { message: "Bug description is required" } });

    let task = null;
    if (taskId) {
      task = await Task.findById(taskId).lean();
      if (!task) return res.status(404).json({ error: { message: "Task not found" } });
    }

    const created = await BugReport.create({
      ...(taskId ? { taskId } : {}),
      taskTitle: String(task?.title || ""),
      title,
      description,
      source: sourceRaw
        ? {
            panel: String(sourceRaw.panel || ""),
            path: String(sourceRaw.path || ""),
          }
        : undefined,
      attachments: attachmentsRaw.map(attachment => ({
        fileName: String(attachment.fileName || ""),
        url: String(attachment.url || ""),
        mimeType: String(attachment.mimeType || ""),
        size: Number(attachment.size || 0),
      })),
      createdByUserId: String(req.user?.sub || req.user?.id || ""),
      createdByUsername: String(req.user?.username || req.user?.name || ""),
      createdByRole: String(req.user?.role || ""),
    });

    const createdObj = created.toObject();
    const createdId = String(createdObj._id);

    void createNotification({
      actor: String(req.user?.username || req.user?.name || "System"),
      actorRole: String(req.user?.role || ""),
      action: "created",
      resourceType: "bug",
      resourceName: title,
      details: String(sourceRaw?.path || sourceRaw?.panel || ""),
      resourceId: createdId,
      recipient: "developer",
      audience: "developer",
    });

    return res.status(201).json({ item: withId(createdObj) });
  } catch (err) {
    return next(err);
  }
});

router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const role = String(req.user?.role || "").toLowerCase();
    if (role !== "super-admin" && role !== "coder") {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }
    const item = await BugReport.findById(req.params.id).lean();
    if (!item) return res.status(404).json({ error: { message: "Bug not found" } });
    return res.json({ item: withId(item) });
  } catch (err) {
    return next(err);
  }
});

router.put("/:id", requireAuth, async (req, res, next) => {
  try {
    const bug = await BugReport.findById(req.params.id);
    if (!bug) return res.status(404).json({ error: { message: "Bug not found" } });

    const role = String(req.user?.role || "").toLowerCase();
    if (role !== "super-admin" && role !== "coder") {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }
    const isAdmin = role === "super-admin";

    const patch = {};
    if (typeof req.body?.status === "string") {
      const status = String(req.body.status).trim();
      if (status !== "open" && status !== "closed") {
        return res.status(400).json({ error: { message: "Invalid status" } });
      }
      patch.status = status;
    }

    // Title and description update (only if open and user is admin/super-admin)
    if (req.body?.title !== undefined || req.body?.description !== undefined) {
      if (!isAdmin) {
        return res.status(403).json({ error: { message: "Forbidden: Only admins can edit bug details" } });
      }
      if (bug.status !== "open") {
        return res.status(400).json({ error: { message: "Cannot edit bug details when status is not open" } });
      }
      if (typeof req.body.title === "string") {
        patch.title = req.body.title.trim();
      }
      if (typeof req.body.description === "string") {
        patch.description = req.body.description.trim();
      }
    }

    const updated = await BugReport.findByIdAndUpdate(req.params.id, patch, { new: false }).lean();
    if (!updated) return res.status(404).json({ error: { message: "Bug not found" } });

    if (patch.status === "closed" && updated.status !== "closed") {
      void createNotification({
        actor: String(req.user?.username || req.user?.name || "Developer"),
        actorRole: String(req.user?.role || ""),
        action: "resolved",
        resourceType: "bug",
        resourceName: String(updated.title || ""),
        details: "Your bug report has been solved",
        resourceId: String(updated._id),
        recipient: updated.createdByUsername || updated.createdByUserId || "admin",
        audience: updated.createdByRole || "admin",
      });
    }

    const finalUpdated = await BugReport.findById(req.params.id).lean();
    return res.json({ item: withId(finalUpdated) });
  } catch (err) {
    return next(err);
  }
});

router.get("/", requireAuth, async (req, res, next) => {
  try {
    const role = String(req.user?.role || "").toLowerCase();
    if (role !== "super-admin" && role !== "coder") {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }
    const items = await BugReport.find().select("-attachments").sort({ createdAt: -1 }).lean();
    res.json({ items: items.map(withId) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
