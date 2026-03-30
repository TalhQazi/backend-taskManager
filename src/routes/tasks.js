const express = require("express");
const { z } = require("zod");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const Task = require("../models/Task");
const TaskComment = require("../models/TaskComment");
const ActivityLog = require("../models/ActivityLog");
const User = require("../models/User");
const { requireAuth } = require("../middleware/auth");
const { checkAndFlagOffTheClock } = require("../lib/offTheClockWork");
const { createNotification } = require("../utils/notifications");

const router = express.Router();
// Middleware to skip body parsing for multipart/form-data (must be before other middleware)
router.use((req, res, next) => {
  const ct = req.headers['content-type'] || '';
  if (ct.includes('multipart/form-data')) {
    // Skip all body parsing for multipart - multer will handle it
    return next();
  }
  next();
});
const uploadsDir = path.resolve(__dirname, "..", "..", "uploads", "tasks");
try {
  fs.mkdirSync(uploadsDir, { recursive: true });
} catch {
  
}

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 16 * 1024 * 1024 }, // 16MB - MongoDB max document size
});

const createSchema = z.object({
  title: z.string().min(1, "Task title is required"),
  description: z.string().min(1, "Task description is required"),
  projectId: z.string().optional(),
  assignees: z.array(z.string()).optional().default([]),
  priority: z.enum(["high", "medium", "low"]).optional(),
  status: z.enum(["pending", "in-progress", "completed", "overdue"]).optional(),
  dueDate: z.union([z.string(), z.date()]).optional(),
  dueTime: z.string().optional().default(""),
  createdAt: z.string().optional().default(""),
  attachmentFileName: z.string().optional().default(""),
  attachmentNote: z.string().optional().default(""),
  attachments: z.array(z.object({
    fileName: z.string().optional().default(""),
    url: z.string().optional().default(""),
    mimeType: z.string().optional().default(""),
    size: z.number().optional().default(0),
    uploadedAt: z.date().optional(),
  })).optional().default([]),
});

const updateSchema = createSchema.partial();

function withId(doc) {
  if (!doc) return doc;
  const legacyAssignee = typeof doc.assignee === "string" ? doc.assignee : "";
  const nextAssignees = Array.isArray(doc.assignees)
    ? doc.assignees
    : legacyAssignee
      ? [legacyAssignee]
      : [];
  const { assignee, assigneeInitials, location, ...rest } = doc;
  return { ...rest, assignees: nextAssignees, id: String(doc._id) };
}

function normalizeAssignees(input) {
  if (Array.isArray(input)) return input.filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim());
  if (typeof input === "string") {
    const v = input.trim();
    return v ? [v] : [];
  }
  return [];
}

function canAccessTask(user, task) {
  const role = String(user?.role || "").trim().toLowerCase();
  const username = String(user?.username || "").trim();
  const name = String(user?.name || "").trim();
  const fullName = String(user?.fullName || "").trim();

  if (role === "super-admin" || role === "admin" || role === "manager") return true;
  if (role === "employee") {
    const assignees = Array.isArray(task?.assignees) ? task.assignees : [];

    const identCandidates = [username, name, fullName]
      .map((v) => String(v || "").trim())
      .filter(Boolean);

    if (identCandidates.length === 0) return false;

    const normalizedAssignees = assignees
      .filter((a) => typeof a === "string")
      .map((a) => a.trim().toLowerCase())
      .filter(Boolean);

    // Allow match by username OR name/fullName since admin might save either.
    return identCandidates.some((cand) => normalizedAssignees.includes(cand.toLowerCase()));
  }

  return false;
}

async function canAccessTaskAsync(user, task) {
  const role = String(user?.role || "").trim().toLowerCase();

  if (role === "super-admin" || role === "admin" || role === "manager") return true;
  if (role !== "employee") return false;

  const legacyAssignee = typeof task?.assignee === "string" ? task.assignee : "";
  const legacyEmployee = typeof task?.employee === "string" ? task.employee : "";

  const assignees = Array.isArray(task?.assignees) ? task.assignees : [];
  const normalizedAssignees = [...assignees, legacyAssignee, legacyEmployee]
    .filter((a) => typeof a === "string")
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean);

  if (normalizedAssignees.length === 0) return false;

  const candidates = [];
  const pushCandidate = (v) => {
    const s = String(v || "").trim();
    if (s) candidates.push(s);
  };

  pushCandidate(user?.username);
  pushCandidate(user?.name);
  pushCandidate(user?.fullName);
  pushCandidate(user?.email);

  // If JWT payload doesn't include name/fullName/email, fetch from DB using sub.
  if (candidates.length <= 1) {
    const userId = String(user?.sub || user?.id || "").trim();
    if (userId) {
      try {
        const dbUser = await User.findById(userId).lean();
        pushCandidate(dbUser?.username);
        pushCandidate(dbUser?.name);
        pushCandidate(dbUser?.email);
      } catch {
        // ignore
      }
    }
  }

  const normalizedCandidates = Array.from(
    new Set(
      candidates
        .map((c) => String(c).trim().toLowerCase())
        .filter(Boolean),
    ),
  );

  // Add name tokens (e.g. "Ali Raza" -> ["ali", "raza"]) to handle assignments saved as parts.
  const tokenCandidates = normalizedCandidates
    .flatMap((c) => c.split(/\s+/g))
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);

  const allCandidates = Array.from(new Set([...normalizedCandidates, ...tokenCandidates]));

  if (allCandidates.length === 0) return false;

  // Exact match
  if (allCandidates.some((c) => normalizedAssignees.includes(c))) return true;

  // Fuzzy match: allow partial contains in either direction (handles "ali raza" vs "ali")
  return allCandidates.some((c) =>
    normalizedAssignees.some((a) => a.includes(c) || c.includes(a)),
  );
}

// Helper to log activity
async function logActivity(req, action, resourceType, resourceId, resourceName, description) {
  try {
    await ActivityLog.create({
      actorUserId: String(req.user?.sub || req.user?.id || "unknown"),
      actorUsername: String(req.user?.username || req.user?.name || "unknown"),
      actorRole: String(req.user?.role || "unknown"),
      action,
      resourceType,
      resourceId: String(resourceId || ""),
      resourceName: String(resourceName || ""),
      description: String(description || ""),
      ipAddress: String(req.ip || req.headers["x-forwarded-for"] || ""),
      userAgent: String(req.headers["user-agent"] || ""),
      metadata: { body: req.body },
    });
  } catch (err) {
    console.error("Failed to log activity:", err);
  }
}

router.get("/", requireAuth, async (_req, res, next) => {
  try {
    const items = await Task.find().sort({ createdAt: -1 }).lean();
    res.json({ items: items.map(withId) });
  } catch (err) {
    next(err);
  }
});

router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const task = await Task.findById(req.params.id).lean();
    if (!task) {
      return res.status(404).json({ error: { message: "Task not found" } });
    }

    const allowed = await canAccessTaskAsync(req.user, task);
    if (!allowed) {
      console.log("[tasks/:id] Forbidden", {
        taskId: String(req.params.id),
        user: {
          sub: req.user?.sub,
          role: req.user?.role,
          username: req.user?.username,
          name: req.user?.name,
          fullName: req.user?.fullName,
          email: req.user?.email,
        },
        assignees: Array.isArray(task?.assignees) ? task.assignees : [],
      });
      return res.status(403).json({ error: { message: "Forbidden" } });
    }

    return res.json({ item: withId(task) });
  } catch (err) {
    return next(err);
  }
});

router.post("/", requireAuth, async (req, res, next) => {
  try {
    // Manual validation for title and description
    if (!req.body?.title || !req.body.title.trim()) {
      return res.status(400).json({ error: { message: "Task title is required" } });
    }
    if (!req.body?.description || !req.body.description.trim()) {
      return res.status(400).json({ error: { message: "Task description is required" } });
    }

    const parsed = createSchema.safeParse({
      ...req.body,
      assignees: normalizeAssignees(req.body?.assignees ?? req.body?.assignee),
    });
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload", details: parsed.error.errors } });
    }

    const dueDate = parsed.data.dueDate ? new Date(parsed.data.dueDate) : undefined;
    const createdAt = parsed.data.createdAt || new Date().toISOString().split("T")[0];
    const firstAssignee = parsed.data.assignees?.[0] || "";

    const created = await Task.create({
      ...parsed.data,
      createdAt,
      dueDate,
    });

    await checkAndFlagOffTheClock({
      employee: firstAssignee,
      userId: String(req.user?.sub || ""),
      timestamp: new Date(),
      activityType: "task_create",
      metadata: { taskId: String(created._id), title: created.title },
    });

    const obj = created.toObject();
    
    // Log activity
    await logActivity(req, "TASK_CREATE", "task", created._id, created.title, `Created task: ${created.title}`);

    await createNotification({
      actor: req.user?.username || req.user?.name || "System",
      actorRole: req.user?.role || "",
      action: "created",
      resourceType: "task",
      resourceName: created.title,
      resourceId: String(created._id),
    });
    
    return res.status(201).json({ item: withId(obj) });
  } catch (err) {
    return next(err);
  }
});

// Upload endpoint with multiple file support (up to 16MB each, MongoDB limit)
router.post("/upload", requireAuth, upload.array("files", 10), async (req, res, next) => {
  try {
    console.log("Upload endpoint hit");
    console.log("Request files:", req.files ? req.files.map(f => ({ name: f.originalname, size: f.size, mimetype: f.mimetype })) : "No files");
    
    const body = req.body || {};

    // Manual validation for title and description
    if (!body.title || !body.title.trim()) {
      return res.status(400).json({ error: { message: "Task title is required" } });
    }
    if (!body.description || !body.description.trim()) {
      return res.status(400).json({ error: { message: "Task description is required" } });
    }

    let parsedAssignees = [];
    if (typeof body.assignees === "string" && body.assignees.trim()) {
      try {
        parsedAssignees = JSON.parse(body.assignees);
      } catch {
        parsedAssignees = body.assignees;
      }
    } else {
      parsedAssignees = body.assignee;
    }

    const payload = {
      title: body.title,
      description: body.description,
      assignees: normalizeAssignees(parsedAssignees),
      priority: body.priority,
      status: body.status,
      dueDate: body.dueDate,
      dueTime: body.dueTime,
      createdAt: body.createdAt,
      attachmentFileName: body.attachmentFileName,
      attachmentNote: body.attachmentNote,
    };

    const parsed = createSchema.safeParse(payload);
    if (!parsed.success) {
      console.error("Validation failed:", parsed.error);
      return res.status(400).json({ error: { message: "Invalid payload", details: parsed.error } });
    }

    const dueDate = parsed.data.dueDate ? new Date(parsed.data.dueDate) : undefined;
    const createdAt = parsed.data.createdAt || new Date().toISOString().split("T")[0];
    const firstAssignee = parsed.data.assignees?.[0] || "";

    // Process multiple files as attachments
    const files = req.files || [];
    let attachments = [];
    let attachment = undefined;
    
    if (files.length > 0) {
      console.log("Processing files:", files.length);
      attachments = files.map(f => {
        if (f.buffer) {
          const base64Data = f.buffer.toString("base64");
          console.log(`File ${f.originalname} - Base64 length:`, base64Data.length);
          return {
            fileName: f.originalname,
            url: `data:${f.mimetype};base64,${base64Data}`,
            mimeType: f.mimetype,
            size: f.size,
            uploadedAt: new Date(),
          };
        }
        return null;
      }).filter(Boolean);
      
      // Set first attachment as legacy single attachment
      attachment = attachments[0];
      console.log("Attachments created:", attachments.length, "First attachment URL length:", attachment?.url?.length);
    } else {
      console.log("No files uploaded");
    }

    console.log("Creating task with attachments:", attachments.length);
    const created = await Task.create({
      ...parsed.data,
      createdAt,
      dueDate,
      attachmentFileName: attachments[0]?.fileName || parsed.data.attachmentFileName || "",
      attachment,
      attachments: attachments.length > 0 ? attachments : undefined,
    });

    await checkAndFlagOffTheClock({
      employee: firstAssignee,
      userId: String(req.user?.sub || ""),
      timestamp: new Date(),
      activityType: "task_create_with_attachment",
      metadata: { taskId: String(created._id), title: created.title },
    });

    console.log("Task created with ID:", created._id);
    const obj = created.toObject();
    
    // Log activity
    await logActivity(req, "TASK_CREATE", "task", created._id, created.title, `Created task with attachment: ${created.title}`);

    // Create notification for task creation
    await createNotification({
      actor: req.user?.username || req.user?.name || "System",
      actorRole: req.user?.role || "",
      action: "created",
      resourceType: "task",
      resourceName: created.title,
      resourceId: String(created._id),
    });
    
    return res.status(201).json({ item: withId(obj) });
  } catch (err) {
    console.error("Upload error:", err);
    return next(err);
  }
});

router.get("/:id/comments", requireAuth, async (req, res, next) => {
  try {
    const task = await Task.findById(req.params.id).lean();
    if (!task) {
      return res.status(404).json({ error: { message: "Task not found" } });
    }

    if (!(await canAccessTaskAsync(req.user, task))) {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }

    const items = await TaskComment.find({ taskId: task._id }).sort({ createdAt: 1 }).lean();

    return res.json({
      items: items.map((c) => ({
        id: String(c._id),
        taskId: String(c.taskId),
        message: String(c.message || ""),
        authorUserId: String(c.authorUserId || ""),
        authorUsername: String(c.authorUsername || ""),
        authorRole: String(c.authorRole || ""),
        createdAt: c.createdAt,
      })),
    });
  } catch (err) {
    return next(err);
  }
});

router.post("/:id/comments", requireAuth, async (req, res, next) => {
  try {
    const task = await Task.findById(req.params.id).lean();
    if (!task) {
      return res.status(404).json({ error: { message: "Task not found" } });
    }

    if (!(await canAccessTaskAsync(req.user, task))) {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }

    const message = String(req.body?.message || "").trim();
    if (!message) {
      return res.status(400).json({ error: { message: "Message is required" } });
    }

    const created = await TaskComment.create({
      taskId: task._id,
      authorUserId: String(req.user?.sub || req.user?.id || ""),
      authorUsername: String(req.user?.username || ""),
      authorRole: String(req.user?.role || ""),
      message,
    });

    await logActivity(req, "TASK_COMMENT_CREATE", "task", task._id, task.title, `Comment added on task: ${task.title}`);

    // Broadcast to all clients in the task room via WebSocket
    const commentData = {
      id: String(created._id),
      taskId: String(created.taskId),
      message: String(created.message || ""),
      authorUserId: String(created.authorUserId || ""),
      authorUsername: String(created.authorUsername || ""),
      authorRole: String(created.authorRole || ""),
      createdAt: created.createdAt,
    };
    
    // Emit to all sockets in the task room except the sender
    if (global.io) {
      global.io.to(`task-${task._id}`).emit("new-comment", commentData);
    }

    return res.status(201).json({
      item: commentData,
    });
  } catch (err) {
    return next(err);
  }
});

// Archive a comment (instead of deleting)
router.post("/:id/comments/:commentId/archive", requireAuth, async (req, res, next) => {
  try {
    const role = String(req.user?.role || "").toLowerCase();
    if (role !== "admin" && role !== "super-admin") {
      return res.status(403).json({ error: { message: "Forbidden: Admin access required" } });
    }

    const task = await Task.findById(req.params.id).lean();
    if (!task) {
      return res.status(404).json({ error: { message: "Task not found" } });
    }

    const comment = await TaskComment.findById(req.params.commentId).lean();
    if (!comment) {
      return res.status(404).json({ error: { message: "Comment not found" } });
    }

    const Archive = require("../models/Archive");
    await Archive.create({
      itemType: "comment",
      itemData: {
        originalId: String(comment._id),
        taskId: String(comment.taskId),
        message: comment.message,
        authorUserId: comment.authorUserId,
        authorUsername: comment.authorUsername,
        authorRole: comment.authorRole,
        createdAt: comment.createdAt,
      },
      parentType: "task",
      parentId: String(task._id),
      parentName: task.title,
      archivedByUserId: String(req.user?.sub || req.user?.id || ""),
      archivedByUsername: String(req.user?.username || ""),
      archivedByRole: String(req.user?.role || ""),
    });

    await TaskComment.findByIdAndDelete(req.params.commentId);
    await logActivity(req, "COMMENT_ARCHIVE", "task", task._id, task.title, `Archived comment on task: ${task.title}`);

    return res.json({ ok: true, message: "Comment archived" });
  } catch (err) {
    return next(err);
  }
});

// Archive an attachment from a task
router.post("/:id/attachments/:attachmentIndex/archive", requireAuth, async (req, res, next) => {
  try {
    const role = String(req.user?.role || "").toLowerCase();
    if (role !== "admin" && role !== "super-admin") {
      return res.status(403).json({ error: { message: "Forbidden: Admin access required" } });
    }

    const task = await Task.findById(req.params.id).lean();
    if (!task) {
      return res.status(404).json({ error: { message: "Task not found" } });
    }

    const idx = parseInt(req.params.attachmentIndex, 10);
    const attachments = Array.isArray(task.attachments) ? task.attachments : [];
    
    // Also handle single attachment field
    let archivedAttachment = null;
    if (idx === -1 && task.attachment) {
      archivedAttachment = task.attachment;
    } else if (idx >= 0 && idx < attachments.length) {
      archivedAttachment = attachments[idx];
    }

    if (!archivedAttachment) {
      return res.status(404).json({ error: { message: "Attachment not found" } });
    }

    const Archive = require("../models/Archive");
    await Archive.create({
      itemType: "attachment",
      itemData: {
        fileName: archivedAttachment.fileName,
        url: archivedAttachment.url,
        mimeType: archivedAttachment.mimeType,
        size: archivedAttachment.size,
        taskId: String(task._id),
      },
      parentType: "task",
      parentId: String(task._id),
      parentName: task.title,
      archivedByUserId: String(req.user?.sub || req.user?.id || ""),
      archivedByUsername: String(req.user?.username || ""),
      archivedByRole: String(req.user?.role || ""),
    });

    // Remove the attachment from the task
    const update = {};
    if (idx === -1 && task.attachment) {
      update.$unset = { attachment: 1, attachmentFileName: 1 };
    } else {
      const newAttachments = [...attachments];
      newAttachments.splice(idx, 1);
      update.$set = { attachments: newAttachments };
    }
    await Task.findByIdAndUpdate(req.params.id, update);

    await logActivity(req, "ATTACHMENT_ARCHIVE", "task", task._id, task.title, `Archived attachment on task: ${task.title}`);

    return res.json({ ok: true, message: "Attachment archived" });
  } catch (err) {
    return next(err);
  }
});

// Archive an entire task (instead of deleting)
router.post("/:id/archive", requireAuth, async (req, res, next) => {
  try {
    const role = String(req.user?.role || "").toLowerCase();
    if (role !== "admin" && role !== "super-admin") {
      return res.status(403).json({ error: { message: "Forbidden: Admin access required" } });
    }

    const task = await Task.findById(req.params.id).lean();
    if (!task) {
      return res.status(404).json({ error: { message: "Task not found" } });
    }

    const Archive = require("../models/Archive");

    // Archive task comments first
    const taskComments = await TaskComment.find({ taskId: String(task._id) }).lean();
    for (const comment of taskComments) {
      await Archive.create({
        itemType: "comment",
        itemData: {
          originalId: String(comment._id),
          taskId: String(comment.taskId),
          message: comment.message,
          authorUserId: comment.authorUserId,
          authorUsername: comment.authorUsername,
          authorRole: comment.authorRole,
          createdAt: comment.createdAt,
        },
        parentType: "task",
        parentId: String(task._id),
        parentName: task.title,
        archivedByUserId: String(req.user?.sub || req.user?.id || ""),
        archivedByUsername: String(req.user?.username || ""),
        archivedByRole: String(req.user?.role || ""),
      });
    }

    // Archive the task itself
    await Archive.create({
      itemType: "task",
      itemData: {
        originalId: String(task._id),
        title: task.title,
        description: task.description,
        assignees: task.assignees,
        priority: task.priority,
        status: task.status,
        dueDate: task.dueDate,
        dueTime: task.dueTime,
        location: task.location,
        projectId: task.projectId,
        attachment: task.attachment,
        attachments: task.attachments,
        createdAt: task.createdAt,
      },
      parentType: task.projectId ? "project" : "standalone",
      parentId: String(task.projectId || task._id),
      parentName: task.title,
      archivedByUserId: String(req.user?.sub || req.user?.id || ""),
      archivedByUsername: String(req.user?.username || ""),
      archivedByRole: String(req.user?.role || ""),
    });

    // Delete comments and the task
    await TaskComment.deleteMany({ taskId: String(task._id) });
    await Task.findByIdAndDelete(req.params.id);

    await logActivity(req, "TASK_ARCHIVE", "task", task._id, task.title, `Archived task: ${task.title}`);

    return res.json({ ok: true, message: "Task archived" });
  } catch (err) {
    return next(err);
  }
});

router.patch("/:id/status", requireAuth, async (req, res, next) => {
  try {
    const task = await Task.findById(req.params.id).lean();
    if (!task) {
      return res.status(404).json({ error: { message: "Task not found" } });
    }

    if (!(await canAccessTaskAsync(req.user, task))) {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }

    const status = String(req.body?.status || "").trim();
    const allowed = new Set(["pending", "in-progress", "completed", "overdue"]);
    if (!allowed.has(status)) {
      return res.status(400).json({ error: { message: "Invalid status" } });
    }

    const updated = await Task.findByIdAndUpdate(req.params.id, { status }, { new: true }).lean();
    if (!updated) {
      return res.status(404).json({ error: { message: "Task not found" } });
    }

    await logActivity(req, "TASK_STATUS_UPDATE", "task", req.params.id, updated.title, `Updated task status: ${updated.title} -> ${status}`);

    await createNotification({
      actor: req.user?.username || req.user?.name || "System",
      actorRole: req.user?.role || "",
      action: "status changed",
      resourceType: "task",
      resourceName: updated.title,
      details: `Status -> ${status}`,
      resourceId: String(req.params.id),
    });

    return res.json({ item: withId(updated) });
  } catch (err) {
    return next(err);
  }
});

router.put("/:id", requireAuth, async (req, res, next) => {
  try {
    const parsed = updateSchema.safeParse({
      ...req.body,
      assignees: normalizeAssignees(req.body?.assignees ?? req.body?.assignee),
    });
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload" } });
    }

    const firstAssignee = parsed.data.assignees?.[0] || "";

    await checkAndFlagOffTheClock({
      employee: firstAssignee,
      userId: String(req.user?.sub || ""),
      timestamp: new Date(),
      activityType: "task_update",
      metadata: { taskId: String(req.params.id) },
    });

    const patch = { ...parsed.data };
    if (patch.dueDate) {
      patch.dueDate = new Date(patch.dueDate);
    }

    delete patch.location;
    delete patch.assignee;
    delete patch.assigneeInitials;

    const updated = await Task.findByIdAndUpdate(req.params.id, patch, {
      new: true,
    }).lean();

    if (!updated) {
      return res.status(404).json({ error: { message: "Task not found" } });
    }

    // Log activity
    await logActivity(req, "TASK_UPDATE", "task", req.params.id, updated.title, `Updated task: ${updated.title}`);

    await createNotification({
      actor: req.user?.username || req.user?.name || "System",
      actorRole: req.user?.role || "",
      action: "updated",
      resourceType: "task",
      resourceName: updated.title,
      resourceId: String(req.params.id),
    });

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
    
    // Log activity
    await logActivity(req, "TASK_DELETE", "task", req.params.id, deleted.title, `Deleted task: ${deleted.title}`);

    await createNotification({
      actor: req.user?.username || req.user?.name || "System",
      actorRole: req.user?.role || "",
      action: "deleted",
      resourceType: "task",
      resourceName: deleted.title,
      resourceId: String(req.params.id),
    });
    
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
