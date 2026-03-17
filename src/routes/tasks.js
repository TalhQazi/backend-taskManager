const express = require("express");
const { z } = require("zod");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const Task = require("../models/Task");
const TaskComment = require("../models/TaskComment");
const ActivityLog = require("../models/ActivityLog");
const { requireAuth } = require("../middleware/auth");
const { checkAndFlagOffTheClock } = require("../lib/offTheClockWork");

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
  limits: { fileSize: 10 * 1024 * 1024 },
});

const createSchema = z.object({
  title: z.string().min(1, "Task title is required"),
  description: z.string().min(1, "Task description is required"),
  assignees: z.array(z.string()).optional().default([]),
  priority: z.enum(["high", "medium", "low"]).optional(),
  status: z.enum(["pending", "in-progress", "completed", "overdue"]).optional(),
  dueDate: z.union([z.string(), z.date()]).optional(),
  dueTime: z.string().optional().default(""),
  createdAt: z.string().optional().default(""),
  attachmentFileName: z.string().optional().default(""),
  attachmentNote: z.string().optional().default(""),
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

  if (role === "super-admin" || role === "admin" || role === "manager") return true;
  if (role === "employee") {
    if (!username) return false;
    const assignees = Array.isArray(task?.assignees) ? task.assignees : [];
    return assignees.includes(username);
  }

  return false;
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
    
    return res.status(201).json({ item: withId(obj) });
  } catch (err) {
    return next(err);
  }
});

router.post("/upload", requireAuth, upload.single("file"), async (req, res, next) => {
  try {
    console.log("Upload endpoint hit");
    console.log("Request file:", req.file ? { name: req.file.originalname, size: req.file.size, mimetype: req.file.mimetype } : "No file");
    
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

    const f = req.file;
    let attachment = undefined;
    
    if (f) {
      console.log("Processing file:", f.originalname, "Size:", f.size);
      if (f.buffer) {
        const base64Data = f.buffer.toString("base64");
        console.log("Base64 length:", base64Data.length);
        attachment = {
          fileName: f.originalname,
          url: `data:${f.mimetype};base64,${base64Data}`,
          mimeType: f.mimetype,
          size: f.size,
        };
        console.log("Attachment created with URL length:", attachment.url.length);
      } else {
        console.error("File has no buffer!");
      }
    } else {
      console.log("No file uploaded");
    }

    console.log("Creating task with attachment:", attachment ? "yes" : "no");
    const created = await Task.create({
      ...parsed.data,
      createdAt,
      dueDate,
      attachmentFileName: f?.originalname || parsed.data.attachmentFileName || "",
      attachment,
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

    if (!canAccessTask(req.user, task)) {
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

    if (!canAccessTask(req.user, task)) {
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

    return res.status(201).json({
      item: {
        id: String(created._id),
        taskId: String(created.taskId),
        message: String(created.message || ""),
        authorUserId: String(created.authorUserId || ""),
        authorUsername: String(created.authorUsername || ""),
        authorRole: String(created.authorRole || ""),
        createdAt: created.createdAt,
      },
    });
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

    if (!canAccessTask(req.user, task)) {
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
    
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
