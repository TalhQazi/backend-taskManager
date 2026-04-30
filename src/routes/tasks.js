const express = require("express");
const mongoose = require("mongoose");
const { z } = require("zod");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const Task = require("../models/Task");
const TaskComment = require("../models/TaskComment");
const ActivityLog = require("../models/ActivityLog");
const User = require("../models/User");
const Attachment = require("../models/Attachment");
const { requireAuth } = require("../middleware/auth");
const { checkAndFlagOffTheClock } = require("../lib/offTheClockWork");
const { createNotification } = require("../utils/notifications");
const { parsePagination, paginatedResponse } = require("../lib/pagination");
const { cacheWrap, cacheDel } = require("../lib/cache");
const { uploadToS3, base64ToBuffer, getFromS3, extractS3Key } = require("../lib/s3");
const contributionTracker = require("../utils/contributionTracker");

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
  location: z.string().optional().default(""),
  createdAt: z.string().optional().default(""),
  attachmentFileName: z.string().optional().default(""),
  attachmentNote: z.string().optional().default(""),
  attachment: z.object({
    fileName: z.string().optional().default(""),
    url: z.string().optional().default(""),
    mimeType: z.string().optional().default(""),
    size: z.number().optional().default(0),
    uploadedAt: z.union([z.date(), z.string()]).optional(),
  }).optional(),
  attachments: z.array(z.object({
    fileName: z.string().optional().default(""),
    url: z.string().optional().default(""),
    mimeType: z.string().optional().default(""),
    size: z.number().optional().default(0),
    uploadedAt: z.union([z.date(), z.string()]).optional(),
  })).optional().default([]),
  // Dropbox attachment references (source == "DROPBOX")
  dropboxAttachments: z.array(z.object({
    file_name: z.string(),
    file_type: z.string().optional().default(""),
    file_size: z.number().optional().default(0),
    dropbox_file_id: z.string(),
    dropbox_path: z.string(),
    temporary_link: z.string().optional().default(""),
  })).optional().default([]),
});

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  projectId: z.string().optional(),
  assignees: z.array(z.string()).optional(),
  priority: z.enum(["high", "medium", "low"]).optional(),
  status: z.enum(["pending", "in-progress", "completed", "overdue"]).optional(),
  dueDate: z.union([z.string(), z.date()]).optional(),
  dueTime: z.string().optional(),
  location: z.string().optional(),
  attachmentFileName: z.string().optional(),
  attachmentNote: z.string().optional(),
  attachment: z.object({
    fileName: z.string().optional(),
    url: z.string().optional(),
    mimeType: z.string().optional(),
    size: z.number().optional(),
    uploadedAt: z.union([z.date(), z.string()]).optional(),
  }).optional(),
  attachments: z.array(z.object({
    fileName: z.string().optional(),
    url: z.string().optional(),
    mimeType: z.string().optional(),
    size: z.number().optional(),
    uploadedAt: z.union([z.date(), z.string()]).optional(),
  })).optional(),
});

function withId(doc) {
  if (!doc) return doc;
  const legacyAssignee = typeof doc.assignee === "string" ? doc.assignee : "";
  const nextAssignees = Array.isArray(doc.assignees)
    ? doc.assignees
    : legacyAssignee
      ? [legacyAssignee]
      : [];
  const { assignee, assigneeInitials, location, ...rest } = doc;
  return { 
    ...rest, 
    assignees: nextAssignees, 
    id: String(doc._id),
    attachments: doc.attachments,
    attachment: doc.attachment,
    attachmentFileName: doc.attachmentFileName,
    attachmentNote: doc.attachmentNote,
    startedAt: doc.startedAt,
    totalTimeSpent: doc.totalTimeSpent || 0,
  };
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

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}


router.get("/", requireAuth, async (req, res, next) => {
  try {
    const role = String(req.user?.role || "").trim().toLowerCase();
    const { page, limit, skip } = parsePagination(req.query);
    const searchQ = String(req.query.search || "").trim();
    const statusQ = String(req.query.status || "").trim();
    const priorityQ = String(req.query.priority || "").trim();
    const projectIdQ = String(req.query.projectId || "").trim();

    const conditions = [];
    const username = String(req.user?.username || "").trim();
    const name = String(req.user?.name || "").trim();
    const fullName = String(req.user?.fullName || "").trim();
    const candidates = [username, name, fullName].filter(Boolean);

    // 1. Accessibility Filter for Employees
    if (role !== "admin" && role !== "super-admin" && role !== "manager") {
      if (candidates.length === 0) {
        return res.json(paginatedResponse([], 0, page, limit));
      }

      // Find projects where the user is an assignee
      const Project = require("../models/Project");
      const assignedProjects = await Project.find({
        assignees: { $elemMatch: { $regex: new RegExp(`^(${candidates.map(escapeRegExp).join("|")})$`, "i") } }
      }).select("_id").lean();
      const assignedProjectIds = assignedProjects.map(p => p._id);

      conditions.push({
        $or: [
          ...candidates.flatMap((c) => [
            { assignees: { $elemMatch: { $regex: new RegExp(`^${escapeRegExp(c)}$`, "i") } } },
            { assignee: { $regex: new RegExp(`^${escapeRegExp(c)}$`, "i") } }, // Legacy
          ]),
          { projectId: { $in: assignedProjectIds } }
        ]
      });
    }

    // 2. Project Filter
    if (projectIdQ) {
      if (projectIdQ === "none") {
        conditions.push({ projectId: { $exists: false } });
      } else {
        try {
          conditions.push({ projectId: new mongoose.Types.ObjectId(projectIdQ) });
        } catch (err) { /* ignore invalid IDs */ }
      }
    }

    // 3. Search Filter
    if (searchQ) {
      const searchRegex = new RegExp(escapeRegExp(searchQ), "i");
      conditions.push({ 
        $or: [
          { title: searchRegex }, 
          { description: searchRegex },
          { assignees: { $elemMatch: { $regex: searchRegex } } },
          { assignee: searchRegex }
        ] 
      });
    }

    // 4. Status Filter
    if (statusQ && statusQ !== "all") {
      conditions.push({ status: statusQ });
    }

    // 5. Priority Filter
    if (priorityQ && priorityQ !== "all") {
      conditions.push({ priority: priorityQ });
    }

    const filter = conditions.length > 0 ? { $and: conditions } : {};

    const cacheKey = `tasks:list:${role}:${req.user?.sub || ''}:p${page}:l${limit}:s${searchQ}:st${statusQ}:pr${priorityQ}`;
    const result = await cacheWrap(cacheKey, async () => {
      const [items, total] = await Promise.all([
        Task.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        Task.countDocuments(filter),
      ]);

      // Append Dropbox attachment count to task objects
      if (items.length > 0) {
        try {
          const taskObjectIds = items.map(i => i._id);
          const counts = await Attachment.aggregate([
            { $match: { task_id: { $in: taskObjectIds }, source: "DROPBOX" } },
            { $group: { _id: "$task_id", count: { $sum: 1 } } }
          ]);
          const countMap = Object.create(null);
          for (const c of counts) {
            countMap[String(c._id)] = c.count;
          }
          for (const item of items) {
            item.dropboxAttachmentCount = countMap[String(item._id)] || 0;
          }
        } catch (aggErr) {
          console.error("[Tasks] Dropbox aggregation failed:", aggErr.message);
        }
      }

      return paginatedResponse(items.map(withId), total, page, limit);
    }, 15);

    res.json(result);
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

// Get task attachment lazily to avoid massive JSON payloads in project views
router.get("/:id/attachment", requireAuth, async (req, res, next) => {
  try {
    const task = await Task.findById(req.params.id).select("attachment").lean();
    if (!task) return res.status(404).json({ error: { message: "Task not found" } });
    res.json({ attachment: task.attachment || { fileName: "", url: "", mimeType: "", size: 0 } });
  } catch (err) {
    next(err);
  }
});

// Get task attachment by index from attachments array
router.get("/:id/attachments/:index", requireAuth, async (req, res, next) => {
  try {
    const task = await Task.findById(req.params.id).select("attachments").lean();
    if (!task) return res.status(404).json({ error: { message: "Task not found" } });
    const idx = parseInt(req.params.index, 10);
    const attachments = Array.isArray(task.attachments) ? task.attachments : [];
    const attachment = attachments[idx];
    if (!attachment) return res.status(404).json({ error: { message: "Attachment not found" } });
    res.json({ url: attachment.url || "" });
  } catch (err) {
    next(err);
  }
});

// ── Get all Dropbox (external) attachments for a task ─────────
// Returns records from the dedicated Attachment collection where source == "DROPBOX".
router.get("/:id/dropbox-attachments", requireAuth, async (req, res, next) => {
  try {
    const task = await Task.findById(req.params.id).lean();
    if (!task) return res.status(404).json({ error: { message: "Task not found" } });

    const allowed = await canAccessTaskAsync(req.user, task);
    if (!allowed) {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }

    const attachments = await Attachment.find({
      task_id: task._id,
      source: "DROPBOX",
    })
      .sort({ created_at: -1 })
      .lean();

    return res.json({
      items: attachments.map((a) => ({
        id: String(a._id),
        task_id: String(a.task_id),
        file_name: a.file_name,
        file_type: a.file_type,
        file_size: a.file_size,
        source: a.source,
        dropbox_file_id: a.dropbox_file_id,
        dropbox_path: a.dropbox_path,
        temporary_link: a.temporary_link,
        created_at: a.created_at,
      })),
    });
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

    // Clean empty projectId to avoid Mongoose CastError
    const body = { ...req.body };
    if (body.projectId === "" || body.projectId === null || body.projectId === "undefined") {
      delete body.projectId;
    }

    const parsed = createSchema.safeParse({
      ...body,
      assignees: normalizeAssignees(body?.assignees ?? body?.assignee),
    });
    
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload", details: parsed.error.errors } });
    }

    const data = parsed.data;

    // Convert Base64 attachments to S3 URLs if present
    if (data.attachment?.url && data.attachment.url.startsWith("data:")) {
      try {
        const { buffer, mimeType } = base64ToBuffer(data.attachment.url);
        const s3Url = await uploadToS3(buffer, data.attachment.fileName || "attachment", mimeType, "tasks");
        data.attachment.url = s3Url;
      } catch (err) {
        console.error("Failed to upload primary attachment to S3:", err);
      }
    }

    if (Array.isArray(data.attachments) && data.attachments.length > 0) {
      data.attachments = await Promise.all(data.attachments.map(async (att) => {
        if (att.url && att.url.startsWith("data:")) {
          try {
            const { buffer, mimeType } = base64ToBuffer(att.url);
            const s3Url = await uploadToS3(buffer, att.fileName || "attachment", mimeType, "tasks");
            return { ...att, url: s3Url, uploadedAt: att.uploadedAt || new Date() };
          } catch (err) {
            console.error("Failed to upload multi-attachment to S3:", err);
            return att;
          }
        }
        return att;
      }));
    }

    const dueDate = data.dueDate ? new Date(data.dueDate) : undefined;
    const createdAt = data.createdAt || new Date().toISOString().split("T")[0];
    const firstAssignee = data.assignees?.[0] || "";

    const lastTask = await Task.findOne().sort({ taskNumber: -1 }).select("taskNumber").lean();
    const nextTaskNumber = (lastTask?.taskNumber || 0) + 1;

    const created = await Task.create({
      ...data,
      taskNumber: nextTaskNumber,
      createdAt,
      dueDate,
    });

    const obj = created.toObject();

    // Save Dropbox attachments (metadata only)
    const dropboxAtts = Array.isArray(data.dropboxAttachments) ? data.dropboxAttachments : [];
    let savedDropboxAttachments = [];
    if (dropboxAtts.length > 0) {
      try {
        const uploaderUserId = String(req.user?.sub || req.user?.id || "");
        savedDropboxAttachments = await Attachment.insertMany(
          dropboxAtts.map((da) => ({
            task_id: created._id,
            file_name: String(da.file_name || "").slice(0, 500),
            file_type: String(da.file_type || "").slice(0, 200),
            file_size: Math.max(0, Number(da.file_size) || 0),
            source: "DROPBOX",
            dropbox_file_id: String(da.dropbox_file_id || "").slice(0, 500),
            dropbox_path: String(da.dropbox_path || "").slice(0, 2000),
            temporary_link: String(da.temporary_link || "").slice(0, 5000),
            uploaded_by: uploaderUserId,
          }))
        );
      } catch (dbxInsertErr) {
        // Log but don't fail task creation — the task is already saved
        console.error("[Tasks] Failed to save Dropbox attachments:", dbxInsertErr.message);
      }
    }

    // Append to response for immediate frontend display
    if (savedDropboxAttachments.length > 0) {
      obj.dropboxAttachments = savedDropboxAttachments;
    }

    // Fire-and-forget side effects (don't block response)
    Promise.allSettled([
      checkAndFlagOffTheClock({
        employee: firstAssignee,
        userId: String(req.user?.sub || ""),
        timestamp: new Date(),
        activityType: "task_create",
        metadata: { taskId: String(created._id), title: created.title },
      }),
      logActivity(req, "TASK_CREATE", "task", created._id, created.title, `Created task: ${created.title}`),
      createNotification({
        actor: req.user?.username || req.user?.name || "System",
        actorRole: req.user?.role || "",
        action: "created",
        resourceType: "task",
        resourceName: created.title,
        assignees: Array.isArray(created.assignees) ? created.assignees : [],
        resourceId: String(created._id),
      }),
      cacheDel("tasks:list:*"),
      created.projectId ? cacheDel(`project:${created.projectId}`) : Promise.resolve(),
      // Track contributor
      contributionTracker.trackTaskCreation(created, {
        userId: String(req.user?.sub || ""),
        name: req.user?.name || req.user?.username || "Unknown",
        email: req.user?.email || "",
        role: req.user?.role || "employee",
      }),
    ]).catch((err) => {
      console.error("Task creation side-effects error:", err);
    });

    return res.status(201).json({ item: withId(obj) });
  } catch (err) {
    console.error("POST /api/tasks Error:", err);
    if (err.name === 'ValidationError') {
      return res.status(400).json({ error: { message: err.message, details: err.errors } });
    }
    if (err.name === 'CastError') {
      return res.status(400).json({ error: { message: `Invalid value for field ${err.path}: ${err.value}` } });
    }
    return next(err);
  }
});

// Upload endpoint with multiple file support (up to 16MB each, MongoDB limit)
router.post("/upload", requireAuth, upload.array("files", 10), async (req, res, next) => {
  try {
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
      attachments = await Promise.all(files.map(async (f) => {
        try {
          // Upload Buffer to S3
          const s3Url = await uploadToS3(f.buffer, f.originalname, f.mimetype, "tasks");
          return {
            fileName: f.originalname,
            url: s3Url,
            mimeType: f.mimetype,
            size: f.size,
            uploadedAt: new Date(),
          };
        } catch (err) {
          console.error("Failed to upload file to S3 in multipart route:", err);
          // Fallback to base64 if S3 fails
          const base64Data = f.buffer.toString("base64");
          return {
            fileName: f.originalname,
            url: `data:${f.mimetype};base64,${base64Data}`,
            mimeType: f.mimetype,
            size: f.size,
            uploadedAt: new Date(),
          };
        }
      }));
      
      // Set first attachment as legacy single attachment
      attachment = attachments[0];
    }

    const lastTask = await Task.findOne().sort({ taskNumber: -1 }).select("taskNumber").lean();
    const nextTaskNumber = (lastTask?.taskNumber || 0) + 1;

    const created = await Task.create({
      ...parsed.data,
      taskNumber: nextTaskNumber,
      createdAt,
      dueDate,
      attachmentFileName: attachments[0]?.fileName || parsed.data.attachmentFileName || "",
      attachment,
      attachments: attachments.length > 0 ? attachments : undefined,
    });

    const obj = created.toObject();

    // Fire-and-forget side effects
    Promise.allSettled([
      checkAndFlagOffTheClock({
        employee: firstAssignee,
        userId: String(req.user?.sub || ""),
        timestamp: new Date(),
        activityType: "task_create_with_attachment",
        metadata: { taskId: String(created._id), title: created.title },
      }),
      logActivity(req, "TASK_CREATE", "task", created._id, created.title, `Created task with attachment: ${created.title}`),
      createNotification({
        actor: req.user?.username || req.user?.name || "System",
        actorRole: req.user?.role || "",
        action: "created",
        resourceType: "task",
        resourceName: created.title,
        assignees: Array.isArray(created.assignees) ? created.assignees : [],
        resourceId: String(created._id),
      }),
      cacheDel("tasks:list:*"),
      created.projectId ? cacheDel(`project:${created.projectId}`) : Promise.resolve(),
    ]).catch(() => {});

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

    const Settings = require("../models/Settings");
    const userIds = [...new Set(items.map(c => c.authorUserId))].filter(Boolean);
    const settingsList = await Settings.find({ userId: { $in: userIds } }).lean();
    
    const settingsMap = {};
    settingsList.forEach(s => {
      settingsMap[s.userId] = {
        fullName: s.fullName || "",
        avatar: s.avatarDataUrl || s.avatarUrl || ""
      };
    });

    return res.json({
      items: items.map((c) => ({
        id: String(c._id),
        taskId: String(c.taskId),
        message: String(c.message || ""),
        authorUserId: String(c.authorUserId || ""),
        authorUsername: String(c.authorUsername || ""),
        authorFullName: (c.authorUserId && settingsMap[c.authorUserId]?.fullName) || "",
        authorAvatar: (c.authorUserId && settingsMap[c.authorUserId]?.avatar) || "",
        authorRole: String(c.authorRole || ""),
        attachments: Array.isArray(c.attachments) ? c.attachments.map(a => ({
          fileName: a.fileName || "",
          mimeType: a.mimeType || "",
          size: a.size || 0,
          uploadedAt: a.uploadedAt
        })) : [],
        reactions: Array.isArray(c.reactions) ? c.reactions : [],
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
    const attachments = Array.isArray(req.body?.attachments) ? req.body.attachments : [];
    
    // We can allow either a message or an attachment
    if (!message && attachments.length === 0) {
      return res.status(400).json({ error: { message: "Message or attachment is required" } });
    }

    const created = await TaskComment.create({
      taskId: task._id,
      authorUserId: String(req.user?.sub || req.user?.id || ""),
      authorUsername: String(req.user?.username || ""),
      authorRole: String(req.user?.role || ""),
      message,
      attachments
    });

    await logActivity(req, "TASK_COMMENT_CREATE", "task", task._id, task.title, `Comment added on task: ${task.title}`);

    // Process Mentions
    if (message.includes("@")) {
      const Employee = require("../models/Employee");
      const activeEmployees = await Employee.find({ status: "active" }).select("name").lean();
      const mentionedUsers = [];
      const lowerMessage = message.toLowerCase();
      
      activeEmployees.forEach(emp => {
        if (lowerMessage.includes("@" + emp.name.toLowerCase())) {
          mentionedUsers.push(emp.name);
        }
      });

      // Also allow mentioning admins if they are in the User collection
      const activeUsers = await User.find({}).select("username").lean();
      activeUsers.forEach(u => {
        if (u.username && lowerMessage.includes("@" + u.username.toLowerCase()) && !mentionedUsers.includes(u.username)) {
          mentionedUsers.push(u.username);
        }
      });

      if (mentionedUsers.length > 0) {
        await createNotification({
          actor: String(req.user?.username || "Someone"),
          actorRole: String(req.user?.role || ""),
          action: "mentioned you in a",
          resourceType: "task comment",
          resourceName: task.title,
          assignees: mentionedUsers,
          details: `"${message.length > 50 ? message.substring(0, 50) + "..." : message}"`,
          resourceId: String(task._id),
        });
      }
    }

    // Notify task assignees and creator about the new comment
    const commentRecipients = new Set([
      ...(Array.isArray(task.assignees) ? task.assignees : []),
      task.createdBy?.name || ""
    ].filter(Boolean));
    if (commentRecipients.size > 0) {
      await createNotification({
        actor: String(req.user?.username || "Someone"),
        actorRole: String(req.user?.role || ""),
        action: "commented on",
        resourceType: "task",
        resourceName: task.title,
        assignees: Array.from(commentRecipients),
        details: `"${message.length > 50 ? message.substring(0, 50) + "..." : message}"`,
        resourceId: String(task._id),
      });
    }

    const Settings = require("../models/Settings");
    const authorUserId = String(req.user?.sub || req.user?.id || "");
    const userSettings = await Settings.findOne({ userId: authorUserId }).lean();

    // Broadcast to all clients in the task room via WebSocket
    const commentData = {
      id: String(created._id),
      taskId: String(created.taskId),
      message: String(created.message || ""),
      authorUserId: authorUserId,
      authorUsername: String(created.authorUsername || ""),
      authorFullName: userSettings?.fullName || "",
      authorAvatar: userSettings?.avatarDataUrl || userSettings?.avatarUrl || "",
      authorRole: String(created.authorRole || ""),
      attachments: Array.isArray(created.attachments) ? created.attachments.map(a => ({
        fileName: a.fileName || "",
        mimeType: a.mimeType || "",
        size: a.size || 0,
        uploadedAt: a.uploadedAt
      })) : [],
      reactions: [],
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

// POST reaction to a comment
router.post("/:id/comments/:commentId/reactions", requireAuth, async (req, res, next) => {
  try {
    const { emoji } = req.body;
    if (!emoji) {
      return res.status(400).json({ error: { message: "Emoji is required" } });
    }

    const userId = String(req.user?.sub || req.user?.id || "");
    const username = String(req.user?.username || "");
    
    const Settings = require("../models/Settings");
    const userSettings = await Settings.findOne({ userId }).lean();
    const fullName = userSettings?.fullName || "";

    const comment = await TaskComment.findById(req.params.commentId);
    if (!comment) {
      return res.status(404).json({ error: { message: "Comment not found" } });
    }

    // Toggle reaction
    const existingIndex = comment.reactions.findIndex(
      (r) => r.emoji === emoji && r.userId === userId
    );

    if (existingIndex > -1) {
      // Remove
      comment.reactions.splice(existingIndex, 1);
    } else {
      // Add
      comment.reactions.push({
        emoji,
        userId,
        username,
        fullName,
        createdAt: new Date(),
      });
    }

    await comment.save();

    const updatedReactions = comment.reactions;

    // Broadcast update
    if (global.io) {
      global.io.to(`task-${req.params.id}`).emit("comment-reaction-updated", {
        commentId: String(comment._id),
        reactions: updatedReactions,
      });
    }

    return res.json({ reactions: updatedReactions });
  } catch (err) {
    return next(err);
  }
});

// GET single comment attachment
router.get("/:id/comments/:commentId/attachments/:index", requireAuth, async (req, res, next) => {
  try {
    const comment = await TaskComment.findById(req.params.commentId).select("attachments").lean();
    if (!comment || !comment.attachments) {
      return res.status(404).json({ error: { message: "Comment or attachment not found" } });
    }
    const idx = parseInt(req.params.index, 10);
    const attachment = comment.attachments[idx];
    if (!attachment) {
      return res.status(404).json({ error: { message: "Attachment index out of bounds" } });
    }
    return res.json({ attachment: { url: attachment.url || "" } });
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

// Edit a comment (Admin can edit any, users can edit their own)
router.patch("/:id/comments/:commentId", requireAuth, async (req, res, next) => {
  try {
    const userId = String(req.user?.sub || req.user?.id || "");
    const userRole = String(req.user?.role || "").toLowerCase();
    const isAdmin = userRole === "admin" || userRole === "super-admin";

    const task = await Task.findById(req.params.id).lean();
    if (!task) {
      return res.status(404).json({ error: { message: "Task not found" } });
    }

    const comment = await TaskComment.findById(req.params.commentId);
    if (!comment) {
      return res.status(404).json({ error: { message: "Comment not found" } });
    }

    // Check permissions: admin can edit any, user can only edit their own
    if (!isAdmin && comment.authorUserId !== userId) {
      return res.status(403).json({ error: { message: "Forbidden: You can only edit your own comments" } });
    }

    const { message, attachments } = req.body;
    if (message !== undefined) comment.message = message;
    if (attachments !== undefined) comment.attachments = attachments;
    comment.updatedAt = new Date();

    await comment.save();

    await logActivity(req, "COMMENT_UPDATE", "task", task._id, task.title, `Comment updated on task: ${task.title}`);

    return res.json({
      item: {
        id: String(comment._id),
        taskId: String(comment.taskId),
        message: String(comment.message || ""),
        authorUserId: String(comment.authorUserId || ""),
        authorUsername: String(comment.authorUsername || ""),
        authorRole: String(comment.authorRole || ""),
        attachments: comment.attachments || [],
        createdAt: comment.createdAt,
        updatedAt: comment.updatedAt,
      },
    });
  } catch (err) {
    return next(err);
  }
});

// Delete a comment (Admin can delete any, users can delete their own)
router.delete("/:id/comments/:commentId", requireAuth, async (req, res, next) => {
  try {
    const userId = String(req.user?.sub || req.user?.id || "");
    const userRole = String(req.user?.role || "").toLowerCase();
    const isAdmin = userRole === "admin" || userRole === "super-admin";

    const task = await Task.findById(req.params.id).lean();
    if (!task) {
      return res.status(404).json({ error: { message: "Task not found" } });
    }

    const comment = await TaskComment.findById(req.params.commentId);
    if (!comment) {
      return res.status(404).json({ error: { message: "Comment not found" } });
    }

    // Check permissions: admin can delete any, user can only delete their own
    if (!isAdmin && comment.authorUserId !== userId) {
      return res.status(403).json({ error: { message: "Forbidden: You can only delete your own comments" } });
    }

    await TaskComment.findByIdAndDelete(req.params.commentId);
    await logActivity(req, "COMMENT_DELETE", "task", task._id, task.title, `Comment deleted on task: ${task.title}`);

    return res.json({ ok: true, message: "Comment deleted" });
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

    // Archive task comments first in bulk
    const taskComments = await TaskComment.find({ taskId: String(task._id) }).lean();
    if (taskComments.length > 0) {
      const commentArchiveEntries = taskComments.map((comment) => ({
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
      }));
      await Archive.insertMany(commentArchiveEntries);
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
    const previousStatus = task.status;
    const allowed = new Set(["pending", "in-progress", "completed", "overdue"]);
    if (!allowed.has(status)) {
      return res.status(400).json({ error: { message: "Invalid status" } });
    }

    const update = { status };
    
    // Timer Logic
    if (status === "in-progress" && task.status !== "in-progress") {
      // Starting the task
      update.startedAt = new Date();
    } else if (task.status === "in-progress" && status !== "in-progress") {
      // Stopping/Completing the task
      const now = new Date();
      const startedAt = task.startedAt ? new Date(task.startedAt) : null;
      if (startedAt) {
        const diffSeconds = Math.floor((now.getTime() - startedAt.getTime()) / 1000);
        update.totalTimeSpent = (task.totalTimeSpent || 0) + diffSeconds;
        update.startedAt = null; // Reset startedAt since it's not currently running
      }
    }

    const updated = await Task.findByIdAndUpdate(req.params.id, update, { new: true }).lean();
    if (!updated) {
      return res.status(404).json({ error: { message: "Task not found" } });
    }

    // Fire-and-forget
    Promise.allSettled([
      logActivity(req, "TASK_STATUS_UPDATE", "task", req.params.id, updated.title, `Updated task status: ${updated.title} -> ${status}`),
      createNotification({
        actor: req.user?.username || req.user?.name || "System",
        actorRole: req.user?.role || "",
        action: "status changed",
        resourceType: "task",
        resourceName: updated.title,
        details: `Status -> ${status}`,
        resourceId: String(req.params.id),
      }),
      cacheDel("tasks:list:*"),
      updated.projectId ? cacheDel(`project:${updated.projectId}`) : Promise.resolve(),
      // Track contribution
      (async () => {
        const taskDoc = await Task.findById(req.params.id);
        if (taskDoc) {
          const changes = [{ field: "status", oldValue: previousStatus, newValue: status }];
          await contributionTracker.trackTaskUpdate(taskDoc, {
            userId: String(req.user?.sub || ""),
            name: req.user?.name || req.user?.username || "Unknown",
            email: req.user?.email || "",
            role: req.user?.role || "employee",
          }, changes, {
            isStatusChange: true,
            description: `Changed task status from "${previousStatus}" to "${status}"`,
            impact: status === "completed" ? "high" : "medium",
          });
          // Track completion separately
          if (status === "completed") {
            await contributionTracker.trackTaskCompletion(taskDoc, {
              userId: String(req.user?.sub || ""),
              name: req.user?.name || req.user?.username || "Unknown",
              email: req.user?.email || "",
              role: req.user?.role || "employee",
            });
          }
        }
      })(),
    ]).catch(() => {});

    return res.json({ item: withId(updated) });
  } catch (err) {
    return next(err);
  }
});

router.put("/:id", requireAuth, async (req, res, next) => {
  try {
    console.log("PUT /api/tasks Update Payload:", JSON.stringify(req.body, null, 2));
    const parseData = { ...req.body };
    if (req.body?.assignees !== undefined || req.body?.assignee !== undefined) {
      parseData.assignees = normalizeAssignees(req.body?.assignees ?? req.body?.assignee);
    }

    const parsed = updateSchema.safeParse(parseData);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload", details: parsed.error.errors } });
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
      const d = new Date(patch.dueDate);
      if (!isNaN(d.getTime())) {
        patch.dueDate = d;
      } else {
        delete patch.dueDate;
      }
    } else if (patch.dueDate === "") {
      patch.dueDate = null;
    }

    // Convert Base64 attachments to S3 URLs if present on update
    if (patch.attachment?.url && patch.attachment.url.startsWith("data:")) {
      try {
        const { buffer, mimeType } = base64ToBuffer(patch.attachment.url);
        const s3Url = await uploadToS3(buffer, patch.attachment.fileName || "attachment", mimeType, "tasks");
        patch.attachment.url = s3Url;
      } catch (err) {
        console.error("Failed to upload updated primary attachment to S3:", err);
      }
    }

    if (Array.isArray(patch.attachments) && patch.attachments.length > 0) {
      patch.attachments = await Promise.all(patch.attachments.map(async (att) => {
        if (att.url && att.url.startsWith("data:")) {
          try {
            const { buffer, mimeType } = base64ToBuffer(att.url);
            const s3Url = await uploadToS3(buffer, att.fileName || "attachment", mimeType, "tasks");
            return { ...att, url: s3Url, uploadedAt: att.uploadedAt || new Date() };
          } catch (err) {
            console.error("Failed to upload updated multi-attachment to S3:", err);
            return att;
          }
        }
        return att;
      }));
    }

    delete patch.assignee;
    delete patch.assigneeInitials;

    const updated = await Task.findByIdAndUpdate(req.params.id, patch, {
      new: true,
    }).lean();

    if (!updated) {
      return res.status(404).json({ error: { message: "Task not found" } });
    }

    // Fire-and-forget
    Promise.allSettled([
      logActivity(req, "TASK_UPDATE", "task", req.params.id, updated.title, `Updated task: ${updated.title}`),
      createNotification({
        actor: req.user?.username || req.user?.name || "System",
        actorRole: req.user?.role || "",
        action: "updated",
        resourceType: "task",
        resourceName: updated.title,
        resourceId: String(req.params.id),
      }),
      cacheDel("tasks:list:*"),
      updated.projectId ? cacheDel(`project:${updated.projectId}`) : Promise.resolve(),
    ]).catch(() => {});

    return res.json({ item: withId(updated) });
  } catch (err) {
    return next(err);
  }
});

// Optimized reassign endpoint - use updateOne instead of findByIdAndUpdate
router.put("/:id/reassign", requireAuth, async (req, res, next) => {
  try {
    const role = String(req.user?.role || "").toLowerCase();
    if (role !== "admin" && role !== "super-admin") {
      return res.status(403).json({ error: { message: "Forbidden: Admin access required" } });
    }

    const assignees = normalizeAssignees(req.body?.assignees);
    if (assignees.length === 0) {
      return res.status(400).json({ error: { message: "At least one assignee is required" } });
    }

    // Use updateOne for better performance - only updates, doesn't fetch full document
    const result = await Task.updateOne(
      { _id: req.params.id },
      { $set: { assignees } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: { message: "Task not found" } });
    }

    // Fetch minimal data for response
    const updated = await Task.findById(req.params.id, {
      title: 1,
      description: 1,
      projectId: 1,
      assignees: 1,
      priority: 1,
      status: 1,
      dueDate: 1,
      dueTime: 1,
      location: 1,
      createdAt: 1,
    }).lean();

    if (!updated) {
      return res.status(404).json({ error: { message: "Task not found" } });
    }

    // Log activity
    await logActivity(req, "TASK_REASSIGN", "task", req.params.id, updated.title, `Reassigned task: ${updated.title} to ${assignees.join(", ")}`);

    await createNotification({
      actor: req.user?.username || req.user?.name || "System",
      actorRole: req.user?.role || "",
      action: "reassigned",
      resourceType: "task",
      resourceName: updated.title,
      resourceId: String(req.params.id),
      details: `New assignees: ${assignees.join(", ")}`,
    });

    return res.json({ item: withId(updated) });
  } catch (err) {
    return next(err);
  }
});

async function archiveTaskById(taskId, archivedBy) {
  const Task = require("../models/Task");
  const Archive = require("../models/Archive");
  
  const task = await Task.findById(taskId).lean();
  if (!task) return null;

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
      startedAt: task.startedAt,
      totalTimeSpent: task.totalTimeSpent,
    },
    parentType: task.projectId ? "project" : "standalone",
    parentId: String(task.projectId || ""),
    parentName: task.projectId ? "Project Tasks" : "Standalone Tasks",
    archivedByUserId: String(archivedBy.sub || archivedBy.id || ""),
    archivedByUsername: String(archivedBy.username || archivedBy.name || ""),
    archivedByRole: String(archivedBy.role || ""),
  });

  await Task.findByIdAndDelete(taskId);
  return task;
}

router.post("/:id/archive", requireAuth, async (req, res, next) => {
  try {
    const role = String(req.user?.role || "").toLowerCase();
    if (role !== "admin" && role !== "super-admin" && role !== "manager") {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }

    const task = await archiveTaskById(req.params.id, req.user);
    if (!task) {
      return res.status(404).json({ error: { message: "Task not found" } });
    }

    // Fire-and-forget
    Promise.allSettled([
      logActivity(req, "TASK_ARCHIVE", "task", req.params.id, task.title, `Archived task: ${task.title}`),
      createNotification({
        actor: req.user?.username || req.user?.name || "System",
        actorRole: req.user?.role || "",
        action: "archived",
        resourceType: "task",
        resourceName: task.title,
        resourceId: String(req.params.id),
      }),
      cacheDel("tasks:list:*"),
      task.projectId ? cacheDel(`project:${task.projectId}`) : Promise.resolve(),
    ]).catch(() => {});

    return res.json({ ok: true, message: "Task archived" });
  } catch (err) {
    return next(err);
  }
});

router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const role = String(req.user?.role || "").toLowerCase();
    if (role !== "admin" && role !== "super-admin") {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }

    const task = await archiveTaskById(req.params.id, req.user);
    if (!task) {
      return res.status(404).json({ error: { message: "Task not found" } });
    }
    
    // Fire-and-forget
    Promise.allSettled([
      logActivity(req, "TASK_DELETE", "task", req.params.id, task.title, `Deleted (Archived) task: ${task.title}`),
      createNotification({
        actor: req.user?.username || req.user?.name || "System",
        actorRole: req.user?.role || "",
        action: "deleted",
        resourceType: "task",
        resourceName: task.title,
        resourceId: String(req.params.id),
      }),
      cacheDel("tasks:list:*"),
      task.projectId ? cacheDel(`project:${task.projectId}`) : Promise.resolve(),
    ]).catch(() => {});
    
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

// Download task attachment by index
router.get("/:id/attachments/:index/download", requireAuth, async (req, res, next) => {
  try {
    const task = await Task.findById(req.params.id).lean();
    if (!task) {
      return res.status(404).json({ error: { message: "Task not found" } });
    }

    const allowed = await canAccessTaskAsync(req.user, task);
    if (!allowed) {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }

    const idx = parseInt(req.params.index, 10);
    const attachments = Array.isArray(task.attachments) ? task.attachments : [];
    
    // Support legacy single attachment at index -1
    let attachment = null;
    if (idx === -1 && task.attachment) {
      attachment = task.attachment;
    } else if (idx >= 0 && idx < attachments.length) {
      attachment = attachments[idx];
    }

    if (!attachment) {
      return res.status(404).json({ error: { message: "Attachment not found" } });
    }

    // If attachment has data URL (base64), decode and serve
    const url = attachment.url || "";
    if (url.startsWith("data:")) {
      const match = url.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        const mimeType = match[1];
        const base64Data = match[2];
        const buffer = Buffer.from(base64Data, "base64");
        res.setHeader("Content-Type", mimeType);
        res.setHeader("Content-Disposition", `attachment; filename="${attachment.fileName || "download"}"`);
        return res.send(buffer);
      }
    }

    // If attachment has external URL, proxy S3 files with download headers
    // (a plain redirect lets S3 serve images without Content-Disposition, so
    // browsers preview PNG/WebP instead of downloading them)
    if (url.startsWith("http://") || url.startsWith("https://")) {
      const s3Key = extractS3Key(url);
      if (s3Key) {
        try {
          const { stream, contentType, contentLength } = await getFromS3(s3Key);
          res.setHeader("Content-Type", attachment.mimeType || contentType);
          res.setHeader("Content-Disposition", `attachment; filename="${attachment.fileName || "download"}"`);
          if (contentLength) res.setHeader("Content-Length", String(contentLength));
          return stream.pipe(res);
        } catch (_) {
          // S3 fetch failed — fall back to redirect
          return res.redirect(url);
        }
      }
      return res.redirect(url);
    }

    // If no URL but has fileName, try to serve from uploads folder
    if (attachment.fileName) {
      const filePath = path.join(uploadsDir, attachment.fileName);
      if (fs.existsSync(filePath)) {
        res.setHeader("Content-Type", attachment.mimeType || "application/octet-stream");
        res.setHeader("Content-Disposition", `attachment; filename="${attachment.fileName}"`);
        return res.sendFile(filePath);
      }
    }

    return res.status(404).json({ error: { message: "Attachment file not available" } });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
