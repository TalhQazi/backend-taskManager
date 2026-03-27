const express = require("express");
const Archive = require("../models/Archive");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// GET all archived items (with optional filters)
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const role = String(req.user?.role || "").toLowerCase();
    if (role !== "admin" && role !== "super-admin") {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }

    const filter = {};
    if (req.query.itemType) filter.itemType = req.query.itemType;
    if (req.query.parentType) filter.parentType = req.query.parentType;
    if (req.query.parentId) filter.parentId = req.query.parentId;

    const items = await Archive.find(filter).sort({ createdAt: -1 }).lean();
    res.json({
      items: items.map((i) => ({
        id: String(i._id),
        itemType: i.itemType,
        itemData: i.itemData,
        parentType: i.parentType,
        parentId: i.parentId,
        parentName: i.parentName,
        archivedByUsername: i.archivedByUsername,
        archivedByRole: i.archivedByRole,
        createdAt: i.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// DELETE permanently from archive (super-admin only)
router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const role = String(req.user?.role || "").toLowerCase();
    if (role !== "super-admin") {
      return res.status(403).json({ error: { message: "Forbidden: Super-admin access required" } });
    }

    const deleted = await Archive.findByIdAndDelete(req.params.id).lean();
    if (!deleted) {
      return res.status(404).json({ error: { message: "Archived item not found" } });
    }

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// RESTORE an archived item (put it back) - admin/super-admin
router.post("/:id/restore", requireAuth, async (req, res, next) => {
  try {
    const role = String(req.user?.role || "").toLowerCase();
    if (role !== "admin" && role !== "super-admin") {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }

    const archived = await Archive.findById(req.params.id).lean();
    if (!archived) {
      return res.status(404).json({ error: { message: "Archived item not found" } });
    }

    // Restore based on type
    const itemType = String(archived.itemType || "").toLowerCase();
    
    if (itemType === "comment") {
      const TaskComment = require("../models/TaskComment");
      const data = archived.itemData || {};
      await TaskComment.create({
        taskId: data.taskId,
        message: data.message,
        authorUserId: data.authorUserId,
        authorUsername: data.authorUsername,
        authorRole: data.authorRole,
      });
    }

    // Remove from archive after restore
    await Archive.findByIdAndDelete(req.params.id);

    res.json({ ok: true, message: "Item restored successfully" });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
