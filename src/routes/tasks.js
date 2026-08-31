const express = require("express");
const mongoose = require("mongoose");
const { z } = require("zod");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const Task = require("../models/Task");
const TaskComment = require("../models/TaskComment");
const ActivityLog = require("../models/ActivityLog");
const Employee = require("../models/Employee");
const Project = require("../models/Project");

const TeamLeadMapping = require("../models/TeamLeadMapping");
const TaskPermission = require("../models/TaskPermission");

const Attachment = require("../models/Attachment");

const { requireAuth } = require("../middleware/auth");
const { checkAndFlagOffTheClock } = require("../lib/offTheClockWork");
const { createNotification } = require("../utils/notifications");
const { extractMentions } = require("../utils/mentions");
const { parsePagination, paginatedResponse } = require("../lib/pagination");
const { cacheWrap, cacheDel } = require("../lib/cache");
const { uploadToS3, saveToServer, base64ToBuffer, getFromS3, extractS3Key } = require("../lib/s3");
const contributionTracker = require("../utils/contributionTracker");
const { sendEmailNotification } = require("../utils/emailNotifications");
const Website = require("../models/Website");

async function handleTaskCompletion(task) {
  try {
    if (task.status === "completed" && task.websiteId) {
      const website = await Website.findById(task.websiteId);
      if (website && (website.websiteType === "in-development" || website.websiteType === "future")) {
        website.websiteType = "active";
        website.status = "Live";
        await website.save();
        console.log(`[handleTaskCompletion] Website ${website.siteName} promoted to active.`);
      }
    }
  } catch (err) {
    console.error("[handleTaskCompletion] Error:", err);
  }
}

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
  description: z.string().optional().default(""),
  projectId: z.string().optional(),
  assignees: z.array(z.string()).optional().default([]),
  teamLead: z.string().optional().default(""),
  priority: z.enum(["high", "medium", "low"]).optional(),
  status: z.enum(["pending", "in-progress", "completed", "overdue"]).optional(),
  dueDate: z.union([z.string(), z.date()]).optional(),
  dueTime: z.string().optional().default(""),
  location: z.string().optional().default(""),
  introVideoUrl: z.string().optional().default(""),
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
  description: z.string().optional(),
  projectId: z.string().optional(),
  assignees: z.array(z.string()).optional(),
  teamLead: z.string().optional(),
  priority: z.enum(["high", "medium", "low"]).optional(),
  status: z.enum(["pending", "in-progress", "completed", "overdue"]).optional(),
  dueDate: z.union([z.string(), z.date()]).optional(),
  dueTime: z.string().optional(),
  location: z.string().optional(),
  introVideoUrl: z.string().optional(),
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
  dropboxAttachments: z.array(z.object({
    file_name: z.string(),
    file_type: z.string().optional().default(""),
    file_size: z.number().optional().default(0),
    dropbox_file_id: z.string(),
    dropbox_path: z.string(),
    temporary_link: z.string().optional().default(""),
  })).optional(),
  customFields: z.record(z.any()).optional(),
});

function serializeTask(doc) {
  if (!doc) return null;
  return {
    id: String(doc._id),
    title: doc.title,
    description: doc.description,
    projectId: doc.projectId ? String(doc.projectId) : undefined,
    assignees: Array.isArray(doc.assignees) ? doc.assignees : [],
    teamLead: doc.teamLead || "",
    priority: doc.priority || "medium",
    status: doc.status || "pending",
    dueDate: doc.dueDate ? doc.dueDate.toISOString() : undefined,
    dueTime: doc.dueTime || "",
    location: doc.location || "",
    introVideoUrl: doc.introVideoUrl || "",
    createdAt: doc.createdAt ? doc.createdAt.toISOString() : undefined,
    updatedAt: doc.updatedAt ? doc.updatedAt.toISOString() : undefined,
    attachment: doc.attachment || undefined,
    attachments: Array.isArray(doc.attachments) ? doc.attachments : [],
    dropboxAttachments: Array.isArray(doc.dropboxAttachments) ? doc.dropboxAttachments : [],
    attachmentFileName: doc.attachmentFileName || "",
    attachmentNote: doc.attachmentNote || "",
    subtasks: Array.isArray(doc.subtasks)
      ? doc.subtasks.map((s) => ({
          id: String(s._id || s.id),
          title: s.title,
          completed: !!s.completed,
          completedAt: s.completedAt ? s.completedAt.toISOString() : undefined,
        }))
      : [],
    customFields: doc.customFields || {},
    totalTimeSpent: doc.totalTimeSpent || 0,
    executionPriority: doc.executionPriority,
  };
}

function normalizeAssignees(input) {
  if (Array.isArray(input)) {
    return input
      .map((s) => {
        if (typeof s === "string") return s.trim();
        if (s && typeof s === "object") return (s.name || s.username || s.email || "").trim();
        return "";
      })
      .filter(Boolean);
  }
  if (typeof input === "string") {
    const v = input.trim();
    return v ? [v] : [];
  }
  if (input && typeof input === "object") {
    const v = (input.name || input.username || input.email || "").trim();
    return v ? [v] : [];
  }
  return [];
}

function withId(doc) {
  if (!doc) return doc;
  const legacyAssignee = typeof doc.assignee === "string" ? doc.assignee : "";
  const nextAssignees = Array.isArray(doc.assignees)
    ? doc.assignees
    : legacyAssignee
      ? [legacyAssignee]
      : [];
  const { assignee, assigneeInitials, ...rest } = doc;
  return { 
    ...rest, 
    assignees: nextAssignees, 
    id: String(doc._id),
    location: doc.location || "",
    taskNumber: doc.taskNumber,
    teamLead: doc.teamLead,
    attachments: doc.attachments,
    attachment: doc.attachment,
    attachmentFileName: doc.attachmentFileName,
    attachmentNote: doc.attachmentNote,
    startedAt: doc.startedAt,
    firstStartedAt: doc.firstStartedAt,
    startedByName: doc.startedByName,
    completedAt: doc.completedAt,
    completedByName: doc.completedByName,
    totalTimeSpent: doc.totalTimeSpent || 0,
    executionPriority: doc.executionPriority,
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
  // Visibility is intentionally unrestricted: every role (super-admin, admin,
  // manager, employee) can see and act on every task.
  return true;
  /* eslint-disable no-unreachable */
  const role = String(user?.role || "").trim().toLowerCase();
  if (role === "super-admin" || role === "admin") return true;
  const username = String(user?.username || "").trim();
  const name = String(user?.name || "").trim();
  const fullName = String(user?.fullName || "").trim();

  const assignees = Array.isArray(task?.assignees) ? task.assignees : [];
  const normalizedAssignees = [...assignees, task.assignee, task.employee, task.teamLead]
    .filter((a) => typeof a === "string")
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean);

  const identCandidates = [username, name, fullName]
    .map((v) => String(v || "").trim())
    .filter(Boolean);

  if (identCandidates.length === 0) return false;

  return identCandidates.some((cand) =>
    normalizedAssignees.some((a) => a.includes(cand.toLowerCase()) || cand.toLowerCase().includes(a))
  );
}

async function canAccessTaskAsync(user, task) {
  // Visibility is intentionally unrestricted: every role (super-admin, admin,
  // manager, employee) can see and act on every task.
  return true;
  /* eslint-disable no-unreachable */
  const role = String(user?.role || "").trim().toLowerCase();
  if (role === "super-admin" || role === "admin") return true;

  const legacyAssignee = typeof task?.assignee === "string" ? task.assignee : "";
  const legacyEmployee = typeof task?.employee === "string" ? task.employee : "";

  const assignees = Array.isArray(task?.assignees) ? task.assignees : [];
  const normalizedAssignees = [...assignees, legacyAssignee, legacyEmployee, task.teamLead]
    .filter((a) => typeof a === "string")
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean);

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
        const dbUser = await Employee.findById(userId).lean();
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

  // Exact or fuzzy match against task assignees
  if (allCandidates.some((c) => normalizedAssignees.includes(c))) return true;
  if (allCandidates.some((c) => normalizedAssignees.some((a) => a.includes(c) || c.includes(a)))) return true;

  // Check project assignment/lead access
  if (task.projectId) {
    try {
      const project = await Project.findById(task.projectId).lean();
      if (project) {
        const isProjectAssignee = (project.assignees || []).some(
          (a) => allCandidates.includes(a.toLowerCase())
        );
        const isProjectLead = allCandidates.includes((project.teamLead || "").toLowerCase());
        if (isProjectAssignee || isProjectLead) return true;
      }
    } catch {
      // ignore
    }
  }

  return false;
}

// Helper to log activity
async function logActivity(req, action, resourceType, resourceId, resourceName, description) {
  try {
    await ActivityLog.create({
      actorUserId: String(req.user?.sub || req.user?.id || "unknown"),
      actorUsername: String(req.user?.name || req.user?.username || "unknown"),
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
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\$&");
}


router.get("/", requireAuth, async (req, res, next) => {
  try {
    const role = String(req.user?.role || "").trim().toLowerCase();
    const { page, limit, skip } = parsePagination(req.query);
    const searchQ = String(req.query.search || "").trim();
    const statusQ = String(req.query.status || "").trim();
    const priorityQ = String(req.query.priority || "").trim();
    const sortQ = String(req.query.sort || "").trim().toLowerCase();
    const projectIdQ = String(req.query.projectId || "").trim();
    const assignment = String(req.query.assignment || "all").trim().toLowerCase();

    const conditions = [];
    const username = String(req.user?.username || "").trim();
    const name = String(req.user?.name || "").trim();
    const fullName = String(req.user?.fullName || "").trim();
    const candidates = [username, name, fullName].filter(Boolean);

    // 1. Accessibility: intentionally unrestricted — every role (super-admin,
    //    admin, manager, employee) sees every task.

    // 1b. Optional due-date range (Calendar / Timeline views). Additive — when
    //     both params are absent the query is unchanged.
    const dueFromQ = String(req.query.dueFrom || "").trim();
    const dueToQ = String(req.query.dueTo || "").trim();
    if (dueFromQ || dueToQ) {
      const range = {};
      const from = new Date(dueFromQ);
      const to = new Date(dueToQ);
      if (dueFromQ && !isNaN(from.getTime())) range.$gte = from;
      if (dueToQ && !isNaN(to.getTime())) range.$lte = to;
      if (Object.keys(range).length) conditions.push({ dueDate: range });
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

    // 5. Assignment Filter
    if (assignment === "unassigned") {
      conditions.push({ assignees: { $size: 0 } });
    } else if (assignment === "assigned") {
      conditions.push({ assignees: { $not: { $size: 0 } } });
    } else if (assignment === "me") {
      if (candidates.length > 0) {
        conditions.push({
          $or: candidates.flatMap((c) => [
            { assignees: { $elemMatch: { $regex: new RegExp(`^${escapeRegExp(c)}$`, "i") } } },
            { assignee: { $regex: new RegExp(`^${escapeRegExp(c)}$`, "i") } }
          ])
        });
      } else {
        conditions.push({ _id: null });
      }
    } else if (assignment && assignment !== "all") {
      conditions.push({
        $or: [
          { assignees: { $elemMatch: { $regex: new RegExp(`^${escapeRegExp(assignment)}$`, "i") } } },
          { assignee: { $regex: new RegExp(`^${escapeRegExp(assignment)}$`, "i") } }
        ]
      });
    }

    // 5. Priority Filter
    if (priorityQ && priorityQ !== "all") {
      conditions.push({ priority: priorityQ });
    }

    // 6. Exact assignee filter (used by the per-employee Task History for server-side paging)
    const assigneeQ = String(req.query.assignee || "").trim();
    if (assigneeQ) {
      conditions.push({ assignees: { $elemMatch: { $regex: new RegExp(`^${escapeRegExp(assigneeQ)}$`, "i") } } });
    }

    const filter = conditions.length > 0 ? { $and: conditions } : {};

    const cacheKey = `tasks:list:${role}:${req.user?.sub || ''}:p${page}:l${limit}:s${searchQ}:st${statusQ}:pr${priorityQ}:so${sortQ}:pid${projectIdQ}:a${assigneeQ}:df${dueFromQ}:dt${dueToQ}`;
    const result = await cacheWrap(cacheKey, async () => {

      const total = await Task.countDocuments(filter);

      // When sorting by execution priority, we want NULLs last.
      // Mongo's default sort places nulls first for ascending sorts, so use an aggregate overlay.
      if (sortQ === "priority") {
        const pipeline = [
          { $match: filter },
          {
            $addFields: {
              __priorityNull: {
                $cond: [{ $eq: ["$executionPriority", null] }, 1, 0],
              },
            },
          },
          { $sort: { __priorityNull: 1, executionPriority: 1, createdAt: -1 } },
          { $skip: skip },
          { $limit: limit },
          { $project: { __priorityNull: 0 } },
        ];

        const items = await Task.aggregate(pipeline);
        return paginatedResponse(items.map(withId), total, page, limit);
      }

      const items = await Task.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean();

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

// Per-assignee task stats (Task History employee list) — aggregation avoids
// shipping every task to the client just to count them.
router.get("/assignee-stats", requireAuth, async (req, res, next) => {
  try {
    const rows = await Task.aggregate([
      { $unwind: "$assignees" },
      {
        $group: {
          _id: "$assignees",
          total: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
          pending: { $sum: { $cond: [{ $in: ["$status", ["pending", "in-progress"]] }, 1, 0] } },
          overdue: { $sum: { $cond: [{ $eq: ["$status", "overdue"] }, 1, 0] } },
        },
      },
    ]);
    const stats = {};
    rows.forEach((r) => {
      stats[String(r._id)] = {
        total: r.total,
        completed: r.completed,
        pending: r.pending,
        overdue: r.overdue,
      };
    });
    res.json({ stats });
  } catch (err) {
    next(err);
  }
});

router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    let task = await Task.findById(req.params.id).lean();
    let isArchived = false;

    if (!task) {
      const Archive = require("../models/Archive");
      const isValidObjId = mongoose.Types.ObjectId.isValid(req.params.id);
      const archivedRecord = await Archive.findOne({
        $or: [
          { originalId: req.params.id },
          ...(isValidObjId ? [{ _id: req.params.id }, { "data._id": new mongoose.Types.ObjectId(req.params.id) }] : []),
          { "data._id": req.params.id }
        ]
      }).lean();

      if (archivedRecord && archivedRecord.data) {
        task = { ...archivedRecord.data, isArchived: true, status: "completed" };
        isArchived = true;
      }
    }

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

    return res.json({ item: { ...withId(task), isArchived } });
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
    const task = await Task.findById(req.params.id).select("attachments attachment").lean();
    if (!task) return res.status(404).json({ error: { message: "Task not found" } });
    const idx = parseInt(req.params.index, 10);
    const attachments = Array.isArray(task.attachments) ? task.attachments : [];

    // Index -1 (and 0 when the array is empty) addresses the legacy single attachment
    let attachment = null;
    if ((idx === -1 || (idx === 0 && attachments.length === 0)) && task.attachment) {
      attachment = task.attachment;
    } else if (idx >= 0 && idx < attachments.length) {
      attachment = attachments[idx];
    }

    if (!attachment) return res.status(404).json({ error: { message: "Attachment not found" } });
    // Clients read `attachment.url`; `url` is kept for older callers.
    res.json({ attachment, url: attachment.url || "" });
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
    const role = String(req.user?.role || "").toLowerCase().trim();
    if (role !== "admin" && role !== "super-admin") {
      return res.status(403).json({ error: { message: "Only administrators are permitted to create tasks." } });
    }

    if (!req.body?.title || !String(req.body.title).trim()) {
      return res.status(400).json({ error: { message: "Task title is required" } });
    }

    // Clean empty projectId to avoid Mongoose CastError
    const body = { ...req.body };
    if (body.projectId === "" || body.projectId === null || body.projectId === "undefined") {
      delete body.projectId;
    }

    // Normalize incoming attachments format
    if (Array.isArray(body.attachments)) {
      body.attachments = body.attachments.map((att) => ({
        fileName: att?.fileName || att?.name || "attachment",
        url: att?.url || att?.uri || "",
        mimeType: att?.mimeType || att?.type || "application/octet-stream",
        size: Number(att?.size) || 0,
        uploadedAt: att?.uploadedAt || new Date(),
      }));
    } else if (body.attachment && typeof body.attachment === "object") {
      body.attachment = {
        fileName: body.attachment.fileName || body.attachment.name || "attachment",
        url: body.attachment.url || body.attachment.uri || "",
        mimeType: body.attachment.mimeType || body.attachment.type || "application/octet-stream",
        size: Number(body.attachment.size) || 0,
        uploadedAt: body.attachment.uploadedAt || new Date(),
      };
    }

    const parsed = createSchema.safeParse({
      ...body,
      description: body.description || "",
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

    // Save Task Video to server disk (recorded/uploaded as base64 data URL)
    if (data.introVideoUrl && data.introVideoUrl.startsWith("data:")) {
      try {
        const { buffer, mimeType } = base64ToBuffer(data.introVideoUrl);
        const videoUrl = await saveToServer(buffer, "task-video", mimeType, "tasks/videos");
        data.introVideoUrl = videoUrl;
      } catch (err) {
        console.error("Failed to save task video to server:", err);
      }
    }

    let dueDate = data.dueDate ? new Date(data.dueDate) : undefined;
    if (dueDate && !isNaN(dueDate.getTime())) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const checkDate = new Date(dueDate);
      checkDate.setHours(0, 0, 0, 0);
      if (checkDate < today && data.status !== "completed") {
        dueDate = undefined;
      }
    }
    const createdAt = data.createdAt || new Date().toISOString().split("T")[0];
    const firstAssignee = data.assignees?.[0] || "";

    const lastTask = await Task.findOne().sort({ taskNumber: -1 }).select("taskNumber").lean();
    const nextTaskNumber = (lastTask?.taskNumber || 0) + 1;

    // Seed timer fields when a task is created directly in a started/closed state,
    // so the timeline can show an accurate start time and running duration.
    const actorName = String(req.user?.name || req.user?.username || "Unknown");
    const timerFields = {};
    if (data.status === "in-progress") {
      const now = new Date();
      timerFields.startedAt = now;
      timerFields.firstStartedAt = now;
      timerFields.startedByName = actorName;
    } else if (data.status === "completed") {
      timerFields.completedAt = new Date();
      timerFields.completedByName = actorName;
    }

    const created = await Task.create({
      ...data,
      ...timerFields,
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
        actor: req.user?.name || req.user?.username || "System",
        actorRole: req.user?.role || "",
        action: "created",
        resourceType: "task",
        resourceName: created.title,
        assignees: Array.isArray(created.assignees) ? created.assignees : [],
        resourceId: String(created._id),
        category: "TASK_ASSIGNED",
      }),
      // Extract mentions from task description
      extractMentions(created.description).then(mentionedUsers => {
        if (mentionedUsers.length > 0) {
          return createNotification({
            actor: req.user?.name || req.user?.username || "System",
            actorRole: req.user?.role || "",
            action: "mentioned you in",
            resourceType: "task",
            resourceName: created.title,
            assignees: mentionedUsers,
            details: `"${created.description.length > 50 ? created.description.substring(0, 50) + "..." : created.description}"`,
            resourceId: String(created._id),
            category: "MENTIONED",
          });
        }
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
      (async () => {
        let projectName = "General";
        if (created.projectId) {
          const proj = await Project.findById(created.projectId).select("name").lean();
          if (proj) projectName = proj.name;
        }
        const assignees = Array.isArray(created.assignees) ? created.assignees : [];
        for (const assignee of assignees) {
          await sendEmailNotification(assignee, "taskAssignment", {
            taskTitle: created.title,
            projectName,
            priority: created.priority || "Normal",
            dueDate: created.dueDate ? new Date(created.dueDate).toLocaleDateString() : "No due date",
            description: created.description || ""
          });
        }
      })()
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
        actor: req.user?.name || req.user?.username || "System",
        actorRole: req.user?.role || "",
        action: "created",
        resourceType: "task",
        resourceName: created.title,
        assignees: Array.isArray(created.assignees) ? created.assignees : [],
        resourceId: String(created._id),
        category: "TASK_ASSIGNED",
      }),
      cacheDel("tasks:list:*"),
      created.projectId ? cacheDel(`project:${created.projectId}`) : Promise.resolve(),
      (async () => {
        let projectName = "General";
        if (created.projectId) {
          const proj = await Project.findById(created.projectId).select("name").lean();
          if (proj) projectName = proj.name;
        }
        const assignees = Array.isArray(created.assignees) ? created.assignees : [];
        for (const assignee of assignees) {
          await sendEmailNotification(assignee, "taskAssignment", {
            taskTitle: created.title,
            projectName,
            priority: created.priority || "Normal",
            dueDate: created.dueDate ? new Date(created.dueDate).toLocaleDateString() : "No due date",
            description: created.description || ""
          });
          if (attachments.length > 0) {
            await sendEmailNotification(assignee, "fileAttachment", {
              fileName: attachments[0]?.fileName || "Attachment",
              taskTitle: created.title
            });
          }
        }
      })()
    ]).catch((err) => {
      console.error("Upload side-effects error:", err);
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

    const { getAuthorProfileMap } = require("../utils/authorProfile");
    const profileMap = await getAuthorProfileMap(items.map((c) => c.authorUserId));

    return res.json({
      items: items.map((c) => ({
        id: String(c._id),
        taskId: String(c.taskId),
        message: String(c.message || ""),
        authorUserId: String(c.authorUserId || ""),
        authorUsername: String(c.authorUsername || ""),
        authorFullName: (c.authorUserId && profileMap[String(c.authorUserId)]?.fullName) || "",
        authorAvatar: (c.authorUserId && profileMap[String(c.authorUserId)]?.avatar) || "",
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

    // Process Mentions using shared utility
    const mentionedUsers = await extractMentions(message);
    if (mentionedUsers.length > 0) {
      await createNotification({
        actor: String(req.user?.name || req.user?.username || "Someone"),
        actorRole: String(req.user?.role || ""),
        action: "mentioned you in a",
        resourceType: "task comment",
        resourceName: task.title,
        assignees: mentionedUsers,
        details: `"${message.length > 50 ? message.substring(0, 50) + "..." : message}"`,
        resourceId: String(task._id),
        category: "MENTIONED",
      });
      mentionedUsers.forEach(user => {
        sendEmailNotification(user, "replyAdded", {
          taskTitle: task.title,
          authorName: req.user?.name || req.user?.username || "Someone",
          replyText: message.length > 50 ? message.substring(0, 50) + "..." : message
        });
      });
    }

    // Notify task assignees and creator about the new comment
    const commentRecipients = new Set([
      ...(Array.isArray(task.assignees) ? task.assignees : []),
      task.createdBy?.name || ""
    ].filter(Boolean));
    if (commentRecipients.size > 0) {
      await createNotification({
        actor: String(req.user?.name || req.user?.username || "Someone"),
        actorRole: String(req.user?.role || ""),
        action: "commented on",
        resourceType: "task",
        resourceName: task.title,
        assignees: Array.from(commentRecipients),
        details: `"${message.length > 50 ? message.substring(0, 50) + "..." : message}"`,
        resourceId: String(task._id),
        category: "COMMENT_ADDED",
      });
      
      Array.from(commentRecipients).forEach(recipient => {
        sendEmailNotification(recipient, "commentAdded", {
          taskTitle: task.title,
          authorName: req.user?.name || req.user?.username || "Someone",
          commentText: message.length > 50 ? message.substring(0, 50) + "..." : message
        });
      });
    }

    const { getAuthorProfile } = require("../utils/authorProfile");
    const authorUserId = String(req.user?.sub || req.user?.id || "");
    const authorProfile = await getAuthorProfile(authorUserId);

    // Broadcast to all clients in the task room via WebSocket
    const commentData = {
      id: String(created._id),
      taskId: String(created.taskId),
      message: String(created.message || ""),
      authorUserId: authorUserId,
      authorUsername: String(created.authorUsername || ""),
      authorFullName: authorProfile.fullName || "",
      authorAvatar: authorProfile.avatar || "",
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

    const { getAuthorProfile } = require("../utils/authorProfile");
    const authorProfile = await getAuthorProfile(comment.authorUserId);

    return res.json({
      item: {
        id: String(comment._id),
        taskId: String(comment.taskId),
        message: String(comment.message || ""),
        authorUserId: String(comment.authorUserId || ""),
        authorUsername: String(comment.authorUsername || ""),
        authorFullName: authorProfile.fullName || "",
        authorAvatar: authorProfile.avatar || "",
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

// Archive/Delete an attachment from a task
router.post("/:id/attachments/:attachmentIndex/archive", requireAuth, async (req, res, next) => {
  try {
    const task = await Task.findById(req.params.id);
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
    try {
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
        archivedByUsername: String(req.user?.name || req.user?.username || ""),
        archivedByRole: String(req.user?.role || ""),
      });
    } catch (e) {
      console.warn("[Task Attachment Archive] Failed to create archive record:", e.message);
    }

    // Remove the attachment from the task
    const update = {};
    if (idx === -1 && task.attachment) {
      update.$unset = { attachment: 1, attachmentFileName: 1 };
    } else {
      const newAttachments = [...attachments];
      newAttachments.splice(idx, 1);
      update.$set = { attachments: newAttachments };
    }
    const updated = await Task.findByIdAndUpdate(req.params.id, update, { new: true });

    void cacheDel(`task:${task._id}`);
    void cacheDel("tasks:list:*");
    if (task.projectId) void cacheDel(`project:${task.projectId}`);

    await logActivity(req, "ATTACHMENT_ARCHIVE", "task", task._id, task.title, `Archived attachment on task: ${task.title}`);

    return res.json({ ok: true, message: "Attachment archived", item: updated });
  } catch (err) {
    return next(err);
  }
});

// Delete attachment endpoint
router.delete("/:id/attachments/:attachmentIndex", requireAuth, async (req, res, next) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) {
      return res.status(404).json({ error: { message: "Task not found" } });
    }

    const idx = parseInt(req.params.attachmentIndex, 10);
    const attachments = Array.isArray(task.attachments) ? task.attachments : [];
    
    let deletedAttachment = null;
    if (idx === -1 && task.attachment) {
      deletedAttachment = task.attachment;
    } else if (idx >= 0 && idx < attachments.length) {
      deletedAttachment = attachments[idx];
    }

    if (!deletedAttachment) {
      return res.status(404).json({ error: { message: "Attachment not found" } });
    }

    const Archive = require("../models/Archive");
    try {
      await Archive.create({
        itemType: "attachment",
        itemData: {
          fileName: deletedAttachment.fileName,
          url: deletedAttachment.url,
          mimeType: deletedAttachment.mimeType,
          size: deletedAttachment.size,
          taskId: String(task._id),
        },
        parentType: "task",
        parentId: String(task._id),
        parentName: task.title,
        archivedByUserId: String(req.user?.sub || req.user?.id || ""),
        archivedByUsername: String(req.user?.name || req.user?.username || ""),
        archivedByRole: String(req.user?.role || ""),
      });
    } catch (e) {
      console.warn("[Task Attachment Delete] Failed to create archive record:", e.message);
    }

    const update = {};
    if (idx === -1 && task.attachment) {
      update.$unset = { attachment: 1, attachmentFileName: 1 };
    } else {
      const newAttachments = [...attachments];
      newAttachments.splice(idx, 1);
      update.$set = { attachments: newAttachments };
    }
    const updated = await Task.findByIdAndUpdate(req.params.id, update, { new: true });

    void cacheDel(`task:${task._id}`);
    void cacheDel("tasks:list:*");
    if (task.projectId) void cacheDel(`project:${task.projectId}`);

    await logActivity(req, "ATTACHMENT_DELETE", "task", task._id, task.title, `Deleted attachment on task: ${task.title}`);

    return res.json({ ok: true, message: "Attachment deleted successfully", item: updated });
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
    let task = await Task.findById(req.params.id).lean();
    let isFromArchive = false;
    let archivedDoc = null;

    if (!task) {
      const Archive = require("../models/Archive");
      const isValidObjId = mongoose.Types.ObjectId.isValid(req.params.id);
      archivedDoc = await Archive.findOne({
        $or: [
          { originalId: req.params.id },
          ...(isValidObjId ? [{ _id: req.params.id }, { "data._id": new mongoose.Types.ObjectId(req.params.id) }] : []),
          { "data._id": req.params.id },
          { "itemData.originalId": req.params.id }
        ]
      });

      if (archivedDoc) {
        const rawData = archivedDoc.data || archivedDoc.itemData || {};
        task = { ...rawData, _id: rawData._id || archivedDoc.originalId || req.params.id };
        isFromArchive = true;
      }
    }

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
    const actorName = String(req.user?.name || req.user?.username || "Unknown");

    // Timer Logic
    if (status === "in-progress" && task.status !== "in-progress") {
      // Starting the task
      update.startedAt = new Date();
      // Permanent "first started" history — only set once
      if (!task.firstStartedAt) {
        update.firstStartedAt = new Date();
        update.startedByName = actorName;
      }
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

    // Permanent "closed/completed" history
    if (status === "completed") {
      update.completedAt = new Date();
      update.completedByName = actorName;
    } else if (task.status === "completed" && status !== "completed") {
      // Task re-opened — clear the completion record
      update.completedAt = null;
      update.completedByName = "";
    }

    if (isFromArchive) {
      const Archive = require("../models/Archive");
      const taskDataToRestore = {
        ...task,
        ...update,
        status,
      };
      delete taskDataToRestore.isArchived;
      delete taskDataToRestore.__v;
      const restored = await Task.create(taskDataToRestore);
      if (archivedDoc) {
        await Archive.deleteOne({ _id: archivedDoc._id });
      }
      return res.json({ item: withId(restored.toObject()) });
    }

    const updated = await Task.findByIdAndUpdate(req.params.id, update, { new: true }).lean();
    if (!updated) {
      return res.status(404).json({ error: { message: "Task not found" } });
    }

    if (updated.status === "completed") {
      void handleTaskCompletion(updated);
      await archiveTaskById(req.params.id, req.user);
    }

    // Fire-and-forget
    Promise.allSettled([
      logActivity(req, "TASK_STATUS_UPDATE", "task", req.params.id, updated.title, `Updated task status: ${updated.title} -> ${status}`),
      // Only notify when a task is completed — other status changes are activity-log only
      ...(status === "completed" ? [createNotification({
        actor: req.user?.name || req.user?.username || "System",
        actorRole: req.user?.role || "",
        action: "completed",
        resourceType: "task",
        resourceName: updated.title,
        assignees: Array.isArray(updated.assignees) ? updated.assignees : [],
        resourceId: String(req.params.id),
        category: "TASK_COMPLETED",
      })] : []),
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

const handleTaskUpdate = async (req, res, next) => {
  try {
    console.log("PUT /api/tasks Update Payload:", JSON.stringify(req.body, null, 2));
    const parseData = { ...req.body };
    if (req.body?.assignees !== undefined || req.body?.assignee !== undefined) {
      parseData.assignees = normalizeAssignees(req.body?.assignees ?? req.body?.assignee);
    }
    if (Array.isArray(req.body?.attachments)) {
      parseData.attachments = req.body.attachments.map((att) => ({
        fileName: att?.fileName || att?.name || "attachment",
        url: att?.url || att?.uri || "",
        mimeType: att?.mimeType || att?.type || "application/octet-stream",
        size: Number(att?.size) || 0,
        uploadedAt: att?.uploadedAt || new Date(),
      }));
    } else if (req.body?.attachment && typeof req.body.attachment === "object") {
      parseData.attachment = {
        fileName: req.body.attachment.fileName || req.body.attachment.name || "attachment",
        url: req.body.attachment.url || req.body.attachment.uri || "",
        mimeType: req.body.attachment.mimeType || req.body.attachment.type || "application/octet-stream",
        size: Number(req.body.attachment.size) || 0,
        uploadedAt: req.body.attachment.uploadedAt || new Date(),
      };
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
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const checkDate = new Date(d);
        checkDate.setHours(0, 0, 0, 0);
        if (checkDate < today && patch.status !== "completed") {
          patch.dueDate = null;
        } else {
          patch.dueDate = d;
        }
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

    // Save Task Video to server disk if update includes a new base64 video
    if (patch.introVideoUrl && patch.introVideoUrl.startsWith("data:")) {
      try {
        const { buffer, mimeType } = base64ToBuffer(patch.introVideoUrl);
        const videoUrl = await saveToServer(buffer, "task-video", mimeType, "tasks/videos");
        patch.introVideoUrl = videoUrl;
      } catch (err) {
        console.error("Failed to save updated task video to server:", err);
      }
    }

    delete patch.assignee;
    delete patch.assigneeInitials;

    // Start/close history when status changes via a full task update
    if (patch.status) {
      const existing = await Task.findById(req.params.id).select("status firstStartedAt").lean();
      if (existing) {
        const actorName = String(req.user?.name || req.user?.username || "Unknown");
        if (patch.status === "in-progress" && existing.status !== "in-progress") {
          patch.startedAt = new Date();
          // Permanent "first started" history — only set once
          if (!existing.firstStartedAt) {
            patch.firstStartedAt = new Date();
            patch.startedByName = actorName;
          }
        }
        if (patch.status === "completed" && existing.status !== "completed") {
          patch.completedAt = new Date();
          patch.completedByName = actorName;
        } else if (existing.status === "completed" && patch.status !== "completed") {
          patch.completedAt = null;
          patch.completedByName = "";
        }
      }
    }

    const updated = await Task.findByIdAndUpdate(req.params.id, patch, {
      new: true,
    }).lean();

    if (!updated) {
      return res.status(404).json({ error: { message: "Task not found" } });
    }

    if (updated.status === "completed") {
      void handleTaskCompletion(updated);
      await archiveTaskById(req.params.id, req.user);
    }

    // Fire-and-forget
    Promise.allSettled([
      logActivity(req, "TASK_UPDATE", "task", req.params.id, updated.title, `Updated task: ${updated.title}`),
      cacheDel("tasks:list:*"),
      updated.projectId ? cacheDel(`project:${updated.projectId}`) : Promise.resolve(),
      (() => {
        const hasNewAttachment = (patch.attachment && patch.attachment.url) || (Array.isArray(patch.attachments) && patch.attachments.length > 0);
        if (hasNewAttachment) {
          return Promise.all((Array.isArray(updated.assignees) ? updated.assignees : []).map(assignee =>
            sendEmailNotification(assignee, "fileAttachment", {
              fileName: patch.attachment?.fileName || patch.attachments?.[0]?.fileName || "New attachment",
              taskTitle: updated.title
            })
          ));
        }
        return Promise.resolve();
      })()
    ]).catch(() => {});

    return res.json({ item: withId(updated) });
  } catch (err) {
    return next(err);
  }
};

router.put("/:id", requireAuth, handleTaskUpdate);
router.patch("/:id", requireAuth, handleTaskUpdate);

// POST /api/tasks/:id/subtasks - Add a subtask
router.post("/:id/subtasks", requireAuth, async (req, res, next) => {
  try {
    const { title } = req.body;
    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: { message: "Subtask title is required" } });
    }
    const task = await Task.findById(req.params.id);
    if (!task) {
      return res.status(404).json({ error: { message: "Task not found" } });
    }
    const newSubtask = {
      title: String(title).trim(),
      completed: false,
      createdAt: new Date(),
    };
    task.subtasks = task.subtasks || [];
    task.subtasks.push(newSubtask);
    await task.save();
    return res.status(201).json({ item: withId(task.toObject()), subtask: newSubtask });
  } catch (err) {
    return next(err);
  }
});

// PATCH /api/tasks/:id/subtasks/:subtaskId - Toggle/Update subtask
router.patch("/:id/subtasks/:subtaskId", requireAuth, async (req, res, next) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) {
      return res.status(404).json({ error: { message: "Task not found" } });
    }
    const subtask = task.subtasks?.id ? task.subtasks.id(req.params.subtaskId) : (task.subtasks || []).find((s) => String(s._id || s.id) === String(req.params.subtaskId));
    if (!subtask) {
      return res.status(404).json({ error: { message: "Subtask not found" } });
    }
    if (req.body.completed !== undefined) {
      subtask.completed = Boolean(req.body.completed);
      if (subtask.completed) {
        subtask.completedAt = new Date();
        subtask.completedBy = String(req.user?.name || req.user?.username || "Unknown");
      } else {
        subtask.completedAt = null;
        subtask.completedBy = "";
      }
    }
    if (req.body.title !== undefined && String(req.body.title).trim()) {
      subtask.title = String(req.body.title).trim();
    }
    await task.save();
    return res.json({ item: withId(task.toObject()), subtask });
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/tasks/:id/subtasks/:subtaskId - Delete subtask
router.delete("/:id/subtasks/:subtaskId", requireAuth, async (req, res, next) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) {
      return res.status(404).json({ error: { message: "Task not found" } });
    }
    task.subtasks = (task.subtasks || []).filter((s) => String(s._id || s.id) !== String(req.params.subtaskId));
    await task.save();
    return res.json({ item: withId(task.toObject()) });
  } catch (err) {
    return next(err);
  }
});

// Optimized reassign endpoint - use updateOne instead of findByIdAndUpdate
router.put("/:id/reassign", requireAuth, async (req, res, next) => {
  try {
    const role = String(req.user?.role || "").toLowerCase();
    if (role !== "admin" && role !== "super-admin" && role !== "team-lead") {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }

    const taskPermission = await TaskPermission.findOne({ taskId: req.params.id }).lean();
    if (role === "team-lead" && taskPermission && taskPermission.canReassign === false) {
      return res.status(403).json({ error: { message: "Forbidden: Task cannot be reassigned" } });
    }

    const assignees = normalizeAssignees(req.body?.assignees);
    if (assignees.length === 0) {
      return res.status(400).json({ error: { message: "At least one assignee is required" } });
    }

    if (role === "team-lead") {
      const teamLeadIdent = String(req.user?.username || req.user?.name || "").trim();
      if (!teamLeadIdent) {
        return res.status(400).json({ error: { message: "Cannot identify team lead" } });
      }

      const mappings = await TeamLeadMapping.find({ teamLead: teamLeadIdent }).lean();
      const mappedUsers = new Set(
        (Array.isArray(mappings) ? mappings : [])
          .map((m) => String(m?.user || "").trim().toLowerCase())
          .filter(Boolean)
      );

      if (mappedUsers.size === 0) {
        return res.status(403).json({ error: { message: "Forbidden: No mapped users for this team lead" } });
      }

      const allowOverrideAdminAssignments = (Array.isArray(mappings) ? mappings : []).some((m) => !!m?.allowOverrideAdminAssignments);

      const requestedAssigneesAllowed = assignees.every((a) => mappedUsers.has(String(a).trim().toLowerCase()));
      if (!requestedAssigneesAllowed) {
        return res.status(403).json({ error: { message: "Forbidden: Can only assign tasks within your mapped users" } });
      }

      if (!allowOverrideAdminAssignments) {
        const existing = await Task.findById(req.params.id, { assignees: 1 }).lean();
        if (!existing) {
          return res.status(404).json({ error: { message: "Task not found" } });
        }

        const currentAssignees = Array.isArray(existing.assignees) ? existing.assignees : [];
        const currentAllInTeam = currentAssignees.every((a) => mappedUsers.has(String(a).trim().toLowerCase()));
        if (!currentAllInTeam) {
          return res.status(403).json({ error: { message: "Forbidden: Cannot override admin assignments" } });
        }
      }
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
      actor: req.user?.name || req.user?.username || "System",
      actorRole: req.user?.role || "",
      action: "reassigned",
      resourceType: "task",
      resourceName: updated.title,
      assignees: assignees,
      resourceId: String(req.params.id),
      details: `New assignees: ${assignees.join(", ")}`,
      category: "TASK_ASSIGNED",
    });

    let projectName = "General";
    if (updated.projectId) {
      const proj = await Project.findById(updated.projectId).select("name").lean();
      if (proj) projectName = proj.name;
    }

    const taskAssignees = Array.isArray(assignees) ? assignees : [];
    for (const assignee of taskAssignees) {
      await sendEmailNotification(assignee, "taskAssignment", {
        taskTitle: updated.title,
        projectName,
        priority: updated.priority || "Normal",
        dueDate: updated.dueDate ? new Date(updated.dueDate).toLocaleDateString() : "No due date",
        description: updated.description || ""
      });
    }

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
      firstStartedAt: task.firstStartedAt,
      startedByName: task.startedByName,
      completedAt: task.completedAt,
      completedByName: task.completedByName,
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
    
    // Support legacy single attachment at index -1 or index 0 fallback
    let attachment = null;
    if ((idx === -1 || (idx === 0 && attachments.length === 0)) && task.attachment) {
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

    // If no URL or local upload URL, try to serve from uploads folder
    const targetFile = attachment.fileName || (url ? path.basename(url) : "");
    if (targetFile) {
      const filePath = path.join(uploadsDir, targetFile);
      if (fs.existsSync(filePath)) {
        res.setHeader("Content-Type", attachment.mimeType || "application/octet-stream");
        res.setHeader("Content-Disposition", `attachment; filename="${targetFile}"`);
        return res.sendFile(filePath);
      }
    }

    return res.status(404).json({ error: { message: "Attachment file not available" } });
  } catch (err) {
    return next(err);
  }
});

// ============================================================================
// Execution Priority System - Admin Only
// ============================================================================

// IMPORTANT: Place specific routes BEFORE parameterized routes
// to avoid Express route matching issues

// DELETE /api/tasks/priorities - Clear all execution priorities (standalone tasks)
router.delete("/priorities", requireAuth, async (req, res, next) => {
  try {
    // Check admin role
    if (!['admin', 'super-admin'].includes(String(req.user?.role || '').trim().toLowerCase())) {
      return res.status(403).json({ error: { message: "Only admins can manage execution priorities" } });
    }

    // Clear execution priorities for all standalone tasks (no projectId)
    await Task.updateMany(
      { projectId: null, executionPriority: { $ne: null } },
      { executionPriority: null }
    );

    // Log activity
    await ActivityLog.create({
      actorUserId: String(req.user?.sub || req.user?.id || "unknown"),
      actorUsername: String(req.user?.name || req.user?.username || req.user?.email || "unknown"),
      actorRole: String(req.user?.role || "unknown"),
      action: "TASK_UPDATE",
      resourceType: "task",
      resourceId: "all-standalone",
      resourceName: "All Standalone Tasks",
      description: "Cleared all execution priorities for standalone tasks",
    });

    // Clear cache
    await cacheDel("tasks:*");
    await cacheDel("projects:*");

    return res.status(200).json({
      success: true,
      message: "All execution priorities cleared for standalone tasks",
    });
  } catch (err) {
    return next(err);
  }
});

// POST /api/tasks/resequence - Global re-sequence of prioritized tasks
router.post("/resequence", requireAuth, async (req, res, next) => {
  try {
    // Check admin role
    if (!['admin', 'super-admin'].includes(String(req.user?.role || '').trim().toLowerCase())) {
      return res.status(403).json({ error: { message: "Only admins can manage execution priorities" } });
    }

    const { taskIds } = req.body;

    if (!Array.isArray(taskIds) || taskIds.length === 0) {
      return res.status(400).json({ error: { message: "taskIds array is required" } });
    }

    // Validate all task IDs
    const validIds = taskIds.filter(id => mongoose.Types.ObjectId.isValid(id));

    // Update tasks with new sequential priorities
    const updatedTasks = [];
    for (let i = 0; i < validIds.length; i++) {
      const task = await Task.findByIdAndUpdate(
        validIds[i],
        { executionPriority: i + 1 },
        { new: true, runValidators: true }
      );
      if (task) {
        updatedTasks.push(task);
      }
    }

    // Log activity
    await ActivityLog.create({
      actorUserId: String(req.user?.sub || req.user?.id || "unknown"),
      actorUsername: String(req.user?.name || req.user?.username || req.user?.email || "unknown"),
      actorRole: String(req.user?.role || "unknown"),
      action: "TASK_UPDATE",
      resourceType: "task",
      resourceId: "batch-resequence",
      resourceName: "Batch Resequence",
      description: `Resequenced ${updatedTasks.length} tasks with execution priorities`,
    });

    // Clear cache
    await cacheDel("tasks:*");
    await cacheDel("projects:*");

    return res.status(200).json({
      success: true,
      items: updatedTasks,
      message: "Tasks re-sequenced successfully",
    });
  } catch (err) {
    return next(err);
  }
});

// POST /api/tasks/:id/priority - Assign execution priority to a task
router.post("/:id/priority", requireAuth, async (req, res, next) => {
  try {
    // Check admin role
    if (!['admin', 'super-admin'].includes(String(req.user?.role || '').trim().toLowerCase())) {
      return res.status(403).json({ error: { message: "Only admins can manage execution priorities" } });
    }

    const { id } = req.params;
    const { executionPriority } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: { message: "Invalid task ID" } });
    }

    if (typeof executionPriority !== "number" || executionPriority < 1) {
      return res.status(400).json({ error: { message: "executionPriority must be a positive number" } });
    }

    const task = await Task.findByIdAndUpdate(
      id,
      { executionPriority },
      { new: true, runValidators: true }
    );

    if (!task) {
      return res.status(404).json({ error: { message: "Task not found" } });
    }

    // Log activity
    await ActivityLog.create({
      actorUserId: String(req.user?.sub || req.user?.id || "unknown"),
      actorUsername: String(req.user?.name || req.user?.username || req.user?.email || "unknown"),
      actorRole: String(req.user?.role || "unknown"),
      action: "TASK_UPDATE",
      resourceType: "task",
      resourceId: String(task._id),
      resourceName: task.title || "",
      description: `Assigned execution priority #${executionPriority} to task "${task.title}"`,
    });

    // Clear cache
    await cacheDel("tasks:*");
    await cacheDel(`task:${id}`);
    await cacheDel("projects:*");
    await cacheDel("project:*");

    return res.status(200).json({
      success: true,
      item: task,
      message: `Execution priority #${executionPriority} assigned successfully`,
    });
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/tasks/:id/priority - Remove execution priority from a task
router.delete("/:id/priority", requireAuth, async (req, res, next) => {
  try {
    // Check admin role
    if (!['admin', 'super-admin'].includes(String(req.user?.role || '').trim().toLowerCase())) {
      return res.status(403).json({ error: { message: "Only admins can manage execution priorities" } });
    }

    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: { message: "Invalid task ID" } });
    }

    const task = await Task.findByIdAndUpdate(
      id,
      { executionPriority: null },
      { new: true, runValidators: true }
    );

    if (!task) {
      return res.status(404).json({ error: { message: "Task not found" } });
    }

    // Re-sequence remaining prioritized tasks
    const projectId = task.projectId;
    const filter = projectId
      ? { projectId, executionPriority: { $ne: null } }
      : { projectId: null, executionPriority: { $ne: null } };

    const prioritizedTasks = await Task.find(filter).sort({ executionPriority: 1 });

    // Update priorities sequentially
    for (let i = 0; i < prioritizedTasks.length; i++) {
      await Task.findByIdAndUpdate(
        prioritizedTasks[i]._id,
        { executionPriority: i + 1 }
      );
    }

    // Log activity
    await ActivityLog.create({
      actorUserId: String(req.user?.sub || req.user?.id || "unknown"),
      actorUsername: String(req.user?.name || req.user?.username || req.user?.email || "unknown"),
      actorRole: String(req.user?.role || "unknown"),
      action: "TASK_UPDATE",
      resourceType: "task",
      resourceId: String(task._id),
      resourceName: task.title || "",
      description: `Removed execution priority from task "${task.title}" and re-sequenced remaining tasks`,
    });

    // Clear cache
    await cacheDel("tasks:*");
    await cacheDel(`task:${id}`);
    await cacheDel("projects:*");

    // Return updated task
    const updatedTask = await Task.findById(id);

    return res.status(200).json({
      success: true,
      item: updatedTask,
      message: "Execution priority removed successfully",
    });
  } catch (err) {
    return next(err);
  }
});

// POST /api/tasks/cleanup-orphaned-assignees — clean up removed/non-existent employees from tasks & projects
router.post("/cleanup-orphaned-assignees", requireAuth, async (req, res, next) => {
  try {
    const Employee = require("../models/Employee");
    const User = require("../models/User");

    const [employees, users] = await Promise.all([
      Employee.find({ status: { $ne: "inactive" } }).select("name email username _id").lean(),
      User.find().select("name email username _id").lean(),
    ]);

    const validTokens = new Set();
    for (const e of employees) {
      if (e.name) validTokens.add(e.name.toLowerCase().trim());
      if (e.email) validTokens.add(e.email.toLowerCase().trim());
      if (e.username) validTokens.add(e.username.toLowerCase().trim());
      if (e._id) validTokens.add(String(e._id).toLowerCase().trim());
    }
    for (const u of users) {
      if (u.name) validTokens.add(u.name.toLowerCase().trim());
      if (u.email) validTokens.add(u.email.toLowerCase().trim());
      if (u.username) validTokens.add(u.username.toLowerCase().trim());
      if (u._id) validTokens.add(String(u._id).toLowerCase().trim());
    }

    const tasks = await Task.find({
      $or: [
        { "assignees.0": { $exists: true } },
        { assignee: { $exists: true, $ne: "" } },
        { employee: { $exists: true, $ne: "" } },
      ],
    });

    let tasksCleaned = 0;
    for (const t of tasks) {
      let changed = false;

      if (Array.isArray(t.assignees) && t.assignees.length > 0) {
        const remaining = t.assignees.filter((a) => {
          const lower = String(a || "").toLowerCase().trim();
          return validTokens.has(lower);
        });
        if (remaining.length !== t.assignees.length) {
          t.assignees = remaining;
          changed = true;
        }
      }

      if (t.assignee && !validTokens.has(String(t.assignee).toLowerCase().trim())) {
        t.assignee = "";
        changed = true;
      }

      if (t.employee && !validTokens.has(String(t.employee).toLowerCase().trim())) {
        t.employee = "";
        changed = true;
      }

      if (changed) {
        await t.save();
        tasksCleaned++;
      }
    }

    await cacheDel("tasks:*");
    await cacheDel("tasks:list:*");
    await cacheDel("projects:*");
    await cacheDel("projects:list:*");

    return res.json({
      success: true,
      message: `Cleaned up ${tasksCleaned} task(s) with orphaned assignees`,
      tasksCleaned,
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
