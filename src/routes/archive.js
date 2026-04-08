const express = require("express");
const Archive = require("../models/Archive");
const { requireAuth } = require("../middleware/auth");
const bcrypt = require("bcryptjs");

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

    const items = await Archive.find(filter)
      .sort({ createdAt: -1 })
      .limit(500)
      .maxTimeMS(8000)
      .allowDiskUse(true)
      .lean();
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

// DELETE permanently from archive (admin or super-admin)
router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const role = String(req.user?.role || "").toLowerCase();
    if (role !== "admin" && role !== "super-admin") {
      return res.status(403).json({ error: { message: "Forbidden: Admin access required" } });
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
    } else if (itemType === "task") {
      const Task = require("../models/Task");
      const data = archived.itemData || {};
      
      // Rebuild the task from archived data
      const taskData = {
        title: data.title,
        description: data.description,
        assignees: data.assignees || [],
        priority: data.priority || "medium",
        status: data.status || "pending",
        dueDate: data.dueDate,
        dueTime: data.dueTime || "",
        location: data.location || "",
        attachment: data.attachment,
        attachments: data.attachments || [],
        createdAt: data.createdAt || new Date(),
      };
      
      // If the task belonged to a project, re-link it
      if (data.projectId) {
        taskData.projectId = data.projectId;
      }
      
      await Task.create(taskData);

      // Also restore any comments that were archived with this task (same parentId)
      const archivedComments = await Archive.find({
        itemType: "comment",
        parentId: archived.parentId,
        parentType: "task",
      }).lean();

      if (archivedComments.length > 0) {
        const TaskComment = require("../models/TaskComment");
        for (const ac of archivedComments) {
          const cd = ac.itemData || {};
          await TaskComment.create({
            taskId: cd.taskId,
            message: cd.message,
            authorUserId: cd.authorUserId,
            authorUsername: cd.authorUsername,
            authorRole: cd.authorRole,
          });
          await Archive.findByIdAndDelete(ac._id);
        }
      }
    } else if (itemType === "attachment") {
      const Task = require("../models/Task");
      const data = archived.itemData || {};
      const taskId = data.taskId;
      
      if (taskId) {
        const task = await Task.findById(taskId);
        if (task) {
          // Re-add the attachment to the task's attachments array
          const attachmentObj = {
            fileName: data.fileName,
            url: data.url,
            mimeType: data.mimeType,
            size: data.size,
          };
          
          if (!Array.isArray(task.attachments)) {
            task.attachments = [];
          }
          task.attachments.push(attachmentObj);
          await task.save();
        }
      }
    }

    else if (itemType === "user") {
      const User = require("../models/User");
      const data = archived.itemData || {};
      let passwordHash = data.passwordHash;

/*
 let passwordHash = data.passwordHash;
if (!passwordHash) {
        const defaultPassword = "123456";
        passwordHash = await bcrypt.hash(defaultPassword, 10);
      }
*/
      if (!passwordHash) {
        const defaultPassword = "123456";
        passwordHash = await bcrypt.hash(defaultPassword, 10);
      }
      await User.create({
        name: data.name || "",
        email: data.email || "",
        username: data.username,          
        passwordHash: data.passwordHash,  
        role: data.role || "employee",
        status: "active",
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
