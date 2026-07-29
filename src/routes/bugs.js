const express = require("express");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const multer = require("multer");

const BugReport = require("../models/BugReport");
const BugComment = require("../models/BugComment");
const BugAttachment = require("../models/BugAttachment");
const BugEvent = require("../models/BugEvent");
const BugParticipant = require("../models/BugParticipant");
const Task = require("../models/Task");
const { requireAuth } = require("../middleware/auth");
const { createNotification } = require("../utils/notifications");

const router = express.Router();

// Setup multer storage for uploaded bug attachments
const uploadDir = path.join(__dirname, "../../uploads/bugs");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 150 * 1024 * 1024 }, // 150 MB max single file
});

function getUserId(req) {
  return String(req.user?.sub || req.user?.id || req.user?.userId || "").trim();
}

function getUserName(req) {
  return String(req.user?.username || req.user?.name || req.user?.email || "User").trim();
}

function getUserRole(req) {
  return String(req.user?.role || req.user?.userRole || "").toLowerCase().trim();
}

function withId(doc) {
  if (!doc) return doc;
  const obj = typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
  obj.id = String(obj._id || obj.id || "");
  return obj;
}

// Helper to log bug audit trail events
async function logBugEvent(bugId, req, eventType, details, metadata = {}) {
  try {
    await BugEvent.create({
      bugId,
      actorId: getUserId(req),
      actorName: getUserName(req),
      actorRole: getUserRole(req),
      eventType,
      details,
      metadata,
    });
    await BugReport.findByIdAndUpdate(bugId, { lastActivity: new Date() });
  } catch (err) {
    console.error("[BugEvent] Failed to log event:", err);
  }
}

// ----------------------------------------------------
// ATTACHMENT & VIDEO UPLOAD ENGINE
// ----------------------------------------------------

router.post("/upload", requireAuth, upload.array("files", 10), async (req, res, next) => {
  try {
    const files = req.files || [];
    if (!files.length) {
      return res.status(400).json({ error: { message: "No files provided" } });
    }

    let combinedSize = 0;
    const processed = [];

    for (const file of files) {
      const mime = file.mimetype.toLowerCase();
      const size = file.size;
      combinedSize += size;

      const isImage = mime.startsWith("image/") || /\.(jpg|jpeg|png|webp|heic)$/i.test(file.originalname);
      const isVideo = mime.startsWith("video/") || /\.(mp4|mov|webm|ogg|mkv)$/i.test(file.originalname);
      const isDoc = /\.(pdf|docx|xlsx)$/i.test(file.originalname) || mime.includes("pdf") || mime.includes("word") || mime.includes("spreadsheet");

      if (!isImage && !isVideo && !isDoc) {
        fs.unlinkSync(file.path);
        return res.status(400).json({ error: { message: `File type not supported: ${file.originalname}` } });
      }

      if (isImage && size > 20 * 1024 * 1024) {
        fs.unlinkSync(file.path);
        return res.status(400).json({ error: { message: `Image exceeds 20 MB limit: ${file.originalname}` } });
      }

      if (isVideo && size > 150 * 1024 * 1024) {
        fs.unlinkSync(file.path);
        return res.status(400).json({ error: { message: `Video exceeds 150 MB limit: ${file.originalname}` } });
      }

      // Calculate file checksum
      const fileBuffer = fs.readFileSync(file.path);
      const checksum = crypto.createHash("sha256").update(fileBuffer).digest("hex");

      const relativeUrl = `/uploads/bugs/${file.filename}`;

      processed.push({
        fileName: file.originalname,
        url: relativeUrl,
        mimeType: file.mimetype,
        size,
        duration: Number(req.body?.duration || 0),
        checksum,
        processingStatus: "completed",
      });
    }

    if (combinedSize > 250 * 1024 * 1024) {
      files.forEach(f => fs.unlinkSync(f.path));
      return res.status(400).json({ error: { message: "Combined file size exceeds 250 MB limit" } });
    }

    return res.status(201).json({ items: processed });
  } catch (err) {
    return next(err);
  }
});

// ----------------------------------------------------
// BUG REPORT MANAGEMENT APIs
// ----------------------------------------------------

// Create Bug Report
router.post("/", requireAuth, async (req, res, next) => {
  try {
    const taskId = String(req.body?.taskId || "").trim();
    const title = String(req.body?.title || "").trim();
    const description = String(req.body?.description || "").trim();
    const severity = String(req.body?.severity || "medium").toLowerCase();
    const priority = String(req.body?.priority || "medium").toLowerCase();
    const company = String(req.body?.company || "").trim();
    const module = String(req.body?.module || "").trim();
    const assignedDeveloperId = String(req.body?.assignedDeveloperId || "").trim();
    const assignedDeveloperName = String(req.body?.assignedDeveloperName || "").trim();
    const attachmentsRaw = Array.isArray(req.body?.attachments) ? req.body.attachments : [];
    const sourceRaw = req.body?.source && typeof req.body.source === "object" ? req.body.source : null;

    if (!title) return res.status(400).json({ error: { message: "Bug title is required" } });
    if (!description) return res.status(400).json({ error: { message: "Bug description is required" } });
    if (attachmentsRaw.length > 10) return res.status(400).json({ error: { message: "Maximum 10 attachments allowed" } });

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
      status: "OPEN",
      severity: ["low", "medium", "high", "critical"].includes(severity) ? severity : "medium",
      priority: ["low", "medium", "high", "urgent"].includes(priority) ? priority : "medium",
      company,
      module,
      assignedDeveloperId,
      assignedDeveloperName,
      source: sourceRaw
        ? {
            panel: String(sourceRaw.panel || ""),
            path: String(sourceRaw.path || ""),
          }
        : undefined,
      attachments: attachmentsRaw.map(att => ({
        fileName: String(att.fileName || ""),
        url: String(att.url || ""),
        mimeType: String(att.mimeType || ""),
        size: Number(att.size || 0),
        duration: Number(att.duration || 0),
        resolution: String(att.resolution || ""),
        width: Number(att.width || 0),
        height: Number(att.height || 0),
        codec: String(att.codec || ""),
        compressedSize: Number(att.compressedSize || 0),
        checksum: String(att.checksum || ""),
        processingStatus: "completed",
      })),
      createdByUserId: getUserId(req),
      createdByUsername: getUserName(req),
      createdByRole: getUserRole(req),
      lastActivity: new Date(),
    });

    const createdObj = withId(created);

    // Audit Event
    await logBugEvent(created._id, req, "BUG_CREATED", `Bug "${title}" was reported.`, { severity, priority });

    // Participant
    await BugParticipant.create({ bugId: created._id, userId: getUserId(req), username: getUserName(req) }).catch(() => {});

    // Notification
    void createNotification({
      actor: getUserName(req),
      actorRole: getUserRole(req),
      action: "created",
      resourceType: "bug",
      resourceName: title,
      details: `Module: ${module || "General"} | Severity: ${severity.toUpperCase()}`,
      resourceId: createdObj.id,
      assignees: assignedDeveloperName ? [assignedDeveloperName] : [],
    });

    return res.status(201).json({ item: createdObj });
  } catch (err) {
    return next(err);
  }
});

// Analytics Dashboard Endpoint
router.get("/analytics", requireAuth, async (req, res, next) => {
  try {
    const all = await BugReport.find({}, {
      status: 1,
      "resolution.submittedAt": 1,
      createdAt: 1,
      module: 1,
      assignedDeveloperName: 1,
      createdByUsername: 1,
    }).lean();

    const total = all.length;
    const pendingBugs = all.filter(b => ["OPEN", "TRIAGED", "IN_PROGRESS", "NEEDS_INFO", "REOPENED", "open"].includes(b.status)).length;
    const awaitingConfirmation = all.filter(b => b.status === "AWAITING_REPORTER_CONFIRMATION" || b.status === "RESOLUTION_SUBMITTED").length;
    const reopenedBugs = all.filter(b => b.status === "REOPENED").length;
    const closedVerified = all.filter(b => b.status === "CLOSED_VERIFIED" || b.status === "closed").length;

    // Calculate Average Resolution Time
    let totalResTimeMs = 0;
    let resCount = 0;
    all.forEach(b => {
      if (b.resolution?.submittedAt && b.createdAt) {
        const diff = new Date(b.resolution.submittedAt).getTime() - new Date(b.createdAt).getTime();
        if (diff > 0) {
          totalResTimeMs += diff;
          resCount++;
        }
      }
    });

    const avgResolutionTimeHours = resCount > 0 ? (totalResTimeMs / (1000 * 60 * 60 * resCount)).toFixed(1) : "0.0";
    const acceptanceRate = (closedVerified + awaitingConfirmation) > 0 ? Math.round((closedVerified / (closedVerified + reopenedBugs || 1)) * 100) : 100;
    const reopenRate = total > 0 ? Math.round((reopenedBugs / total) * 100) : 0;

    // Top Modules
    const moduleMap = {};
    const devMap = {};
    const reporterMap = {};

    all.forEach(b => {
      const mod = b.module || "General";
      moduleMap[mod] = (moduleMap[mod] || 0) + 1;

      if (b.assignedDeveloperName) {
        devMap[b.assignedDeveloperName] = (devMap[b.assignedDeveloperName] || 0) + 1;
      }
      if (b.createdByUsername) {
        reporterMap[b.createdByUsername] = (reporterMap[b.createdByUsername] || 0) + 1;
      }
    });

    return res.json({
      total,
      pendingBugs,
      awaitingConfirmation,
      reopenedBugs,
      closedVerified,
      avgResolutionTimeHours,
      acceptanceRate,
      reopenRate,
      topModules: Object.entries(moduleMap).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 5),
      topDevelopers: Object.entries(devMap).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 5),
      topReporters: Object.entries(reporterMap).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 5),
    });
  } catch (err) {
    return next(err);
  }
});

// List Bugs with Filters & Pagination (25 items per page default)
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const { company, module, severity, priority, status = "open", developer, reporter, q, page: rawPage, limit: rawLimit } = req.query;

    const page = Math.max(1, parseInt(rawPage, 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(rawLimit, 10) || 25));
    const skip = (page - 1) * limit;

    const filter = {};

    if (company) filter.company = String(company);
    if (module) filter.module = String(module);
    if (severity && severity !== "all") filter.severity = String(severity);
    if (priority && priority !== "all") filter.priority = String(priority);

    if (status && status !== "all") {
      if (status === "open") filter.status = { $in: ["OPEN", "TRIAGED", "IN_PROGRESS", "NEEDS_INFO", "REOPENED", "open"] };
      else if (status === "closed") filter.status = { $in: ["CLOSED_VERIFIED", "CLOSED_ADMIN_OVERRIDE", "closed"] };
      else filter.status = String(status);
    }

    if (developer) filter.assignedDeveloperName = new RegExp(String(developer), "i");
    if (reporter) filter.createdByUsername = new RegExp(String(reporter), "i");

    if (q) {
      const search = String(q).trim();
      filter.$or = [
        { title: new RegExp(search, "i") },
        { description: new RegExp(search, "i") },
        { taskTitle: new RegExp(search, "i") },
        { createdByUsername: new RegExp(search, "i") },
        { assignedDeveloperName: new RegExp(search, "i") },
        { module: new RegExp(search, "i") },
      ];
    }

    const [totalItems, items] = await Promise.all([
      BugReport.countDocuments(filter),
      BugReport.find(filter)
        .sort({ lastActivity: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select("title description status severity priority company module taskTitle createdByUsername createdByRole assignedDeveloperName createdAt source attachments.fileName attachments.url attachments.mimeType attachments.size")
        .lean(),
    ]);

    const totalPages = Math.ceil(totalItems / limit) || 1;

    return res.json({
      items: items.map(withId),
      pagination: {
        totalItems,
        totalPages,
        currentPage: page,
        limit,
      },
    });
  } catch (err) {
    return next(err);
  }
});

// Get Single Bug Detail
router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const item = await BugReport.findById(req.params.id).lean();
    if (!item) return res.status(404).json({ error: { message: "Bug report not found" } });

    // Mark read for current user
    await BugParticipant.findOneAndUpdate(
      { bugId: req.params.id, userId: getUserId(req) },
      { username: getUserName(req), lastReadAt: new Date() },
      { upsert: true }
    ).catch(() => {});

    return res.json({ item: withId(item) });
  } catch (err) {
    return next(err);
  }
});

// Update Bug Details, Triage, Status & Assignment
router.put("/:id", requireAuth, async (req, res, next) => {
  try {
    const bug = await BugReport.findById(req.params.id);
    if (!bug) return res.status(404).json({ error: { message: "Bug not found" } });

    const role = getUserRole(req);
    const isAdmin = ["admin", "super-admin"].includes(role);
    const isReporter = bug.createdByUserId === getUserId(req) || bug.createdByUsername === getUserName(req);

    const patch = { lastActivity: new Date() };

    // Triage / Priority / Severity / Assignment
    if (typeof req.body?.severity === "string") {
      patch.severity = req.body.severity;
      await logBugEvent(bug._id, req, "SEVERITY_CHANGED", `Severity changed to ${req.body.severity.toUpperCase()}`);
    }

    if (typeof req.body?.priority === "string") {
      patch.priority = req.body.priority;
      await logBugEvent(bug._id, req, "PRIORITY_CHANGED", `Priority changed to ${req.body.priority.toUpperCase()}`);
    }

    if (typeof req.body?.assignedDeveloperId === "string" || typeof req.body?.assignedDeveloperName === "string") {
      patch.assignedDeveloperId = String(req.body.assignedDeveloperId || "");
      patch.assignedDeveloperName = String(req.body.assignedDeveloperName || "");
      await logBugEvent(
        bug._id,
        req,
        "ASSIGNED",
        `Assigned to developer: ${patch.assignedDeveloperName || "Unassigned"}`
      );
    }

    // Status Updates
    if (typeof req.body?.status === "string") {
      const nextStatus = req.body.status.toUpperCase();

      // Developers must NEVER directly close a bug!
      if (["CLOSED_VERIFIED", "CLOSED"].includes(nextStatus) && !isAdmin && !isReporter) {
        return res.status(403).json({
          error: { message: "Developers cannot directly close a bug. Please submit resolution for reporter confirmation." },
        });
      }

      patch.status = nextStatus;
      await logBugEvent(bug._id, req, "STATUS_CHANGED", `Status changed to ${nextStatus}`);
    }

    if (isAdmin && (req.body?.title || req.body?.description)) {
      if (req.body.title) patch.title = req.body.title.trim();
      if (req.body.description) patch.description = req.body.description.trim();
    }

    const updated = await BugReport.findByIdAndUpdate(req.params.id, patch, { new: true }).lean();

    return res.json({ item: withId(updated) });
  } catch (err) {
    return next(err);
  }
});

// ----------------------------------------------------
// CONVERSATION THREAD APIs
// ----------------------------------------------------

// Get Comments for Bug
router.get("/:id/comments", requireAuth, async (req, res, next) => {
  try {
    const comments = await BugComment.find({ bugId: req.params.id }).sort({ createdAt: 1 }).lean();
    return res.json({ items: comments.map(withId) });
  } catch (err) {
    return next(err);
  }
});

// Add Comment
router.post("/:id/comments", requireAuth, async (req, res, next) => {
  try {
    const bug = await BugReport.findById(req.params.id);
    if (!bug) return res.status(404).json({ error: { message: "Bug not found" } });

    const content = String(req.body?.content || "").trim();
    const attachments = Array.isArray(req.body?.attachments) ? req.body.attachments : [];

    if (!content && !attachments.length) {
      return res.status(400).json({ error: { message: "Comment content or attachment is required" } });
    }

    if (content.length > 10000) {
      return res.status(400).json({ error: { message: "Comment exceeds 10,000 characters limit" } });
    }

    if (attachments.length > 10) {
      return res.status(400).json({ error: { message: "Maximum 10 attachments per comment allowed" } });
    }

    // Extract @mentions
    const mentions = (content.match(/@[\w\.-]+/g) || []).map(m => m.replace("@", ""));

    const comment = await BugComment.create({
      bugId: bug._id,
      userId: getUserId(req),
      username: getUserName(req),
      userRole: getUserRole(req),
      userAvatarUrl: String(req.body?.userAvatarUrl || ""),
      content,
      attachments,
      mentions,
    });

    const commentObj = withId(comment);

    await logBugEvent(bug._id, req, "COMMENT_ADDED", `${getUserName(req)} added a comment.`);

    // Notification
    void createNotification({
      actor: getUserName(req),
      actorRole: getUserRole(req),
      action: "commented on",
      resourceType: "bug",
      resourceName: bug.title,
      details: content.substring(0, 80),
      resourceId: String(bug._id),
      assignees: [bug.createdByUsername, bug.assignedDeveloperName].filter(Boolean),
    });

    return res.status(201).json({ item: commentObj });
  } catch (err) {
    return next(err);
  }
});

// Edit Comment (5-minute window rule)
router.put("/:id/comments/:commentId", requireAuth, async (req, res, next) => {
  try {
    const comment = await BugComment.findById(req.params.commentId);
    if (!comment) return res.status(404).json({ error: { message: "Comment not found" } });

    if (comment.userId !== getUserId(req) && comment.username !== getUserName(req)) {
      return res.status(403).json({ error: { message: "You can only edit your own comment" } });
    }

    const elapsedMs = Date.now() - new Date(comment.createdAt).getTime();
    if (elapsedMs > 5 * 60 * 1000) {
      return res.status(400).json({ error: { message: "Comments can only be edited within 5 minutes of posting" } });
    }

    const content = String(req.body?.content || "").trim();
    if (!content) return res.status(400).json({ error: { message: "Comment content cannot be empty" } });

    comment.content = content;
    comment.isEdited = true;
    comment.editedAt = new Date();
    await comment.save();

    await logBugEvent(comment.bugId, req, "COMMENT_EDITED", `${getUserName(req)} edited their comment.`);

    return res.json({ item: withId(comment) });
  } catch (err) {
    return next(err);
  }
});

// Delete Comment (Soft Delete)
router.delete("/:id/comments/:commentId", requireAuth, async (req, res, next) => {
  try {
    const comment = await BugComment.findById(req.params.commentId);
    if (!comment) return res.status(404).json({ error: { message: "Comment not found" } });

    const role = getUserRole(req);
    const isAdmin = ["admin", "super-admin"].includes(role);

    if (!isAdmin && comment.userId !== getUserId(req) && comment.username !== getUserName(req)) {
      return res.status(403).json({ error: { message: "Permission denied" } });
    }

    comment.isDeleted = true;
    comment.deletedAt = new Date();
    comment.content = "Comment Removed";
    comment.attachments = [];
    await comment.save();

    await logBugEvent(comment.bugId, req, "COMMENT_DELETED", `${getUserName(req)} removed a comment.`);

    return res.json({ item: withId(comment) });
  } catch (err) {
    return next(err);
  }
});

// ----------------------------------------------------
// RESOLUTION & REPORTER VERIFICATION WORKFLOW APIs
// ----------------------------------------------------

// Submit Resolution (Developers/Team Leads/Admins)
router.post("/:id/resolution", requireAuth, async (req, res, next) => {
  try {
    const bug = await BugReport.findById(req.params.id);
    if (!bug) return res.status(404).json({ error: { message: "Bug report not found" } });

    const summary = String(req.body?.summary || "").trim();
    const verificationPerformed = String(req.body?.verificationPerformed || "").trim();
    const releaseVersion = String(req.body?.releaseVersion || "").trim();
    const deploymentEnvironment = String(req.body?.deploymentEnvironment || "").trim();
    const commitUrl = String(req.body?.commitUrl || "").trim();
    const pullRequestUrl = String(req.body?.pullRequestUrl || "").trim();
    const disposition = String(req.body?.disposition || "Fixed").trim();
    const attachments = Array.isArray(req.body?.attachments) ? req.body.attachments : [];

    if (!summary) return res.status(400).json({ error: { message: "Resolution summary is required" } });
    if (!verificationPerformed) return res.status(400).json({ error: { message: "Verification performed details are required" } });

    bug.resolution = {
      summary,
      verificationPerformed,
      releaseVersion,
      deploymentEnvironment,
      commitUrl,
      pullRequestUrl,
      attachments,
      disposition,
      submittedBy: getUserName(req),
      submittedAt: new Date(),
    };

    bug.status = "AWAITING_REPORTER_CONFIRMATION";
    bug.lastActivity = new Date();
    await bug.save();

    await logBugEvent(
      bug._id,
      req,
      "RESOLUTION_SUBMITTED",
      `Resolution submitted by ${getUserName(req)}. Awaiting reporter confirmation.`,
      { disposition, releaseVersion }
    );

    // Notify original reporter
    void createNotification({
      actor: getUserName(req),
      actorRole: getUserRole(req),
      action: "submitted resolution for",
      resourceType: "bug",
      resourceName: bug.title,
      details: summary.substring(0, 100),
      resourceId: String(bug._id),
      assignees: [bug.createdByUsername],
    });

    return res.json({ item: withId(bug) });
  } catch (err) {
    return next(err);
  }
});

// Confirm Resolution (Reporter Verification - YES)
router.post("/:id/confirm-resolution", requireAuth, async (req, res, next) => {
  try {
    const bug = await BugReport.findById(req.params.id);
    if (!bug) return res.status(404).json({ error: { message: "Bug report not found" } });

    const role = getUserRole(req);
    const isAdmin = ["admin", "super-admin"].includes(role);
    const isReporter = bug.createdByUserId === getUserId(req) || bug.createdByUsername === getUserName(req);

    if (!isReporter && !isAdmin) {
      return res.status(403).json({ error: { message: "Only the original reporter can verify the resolution." } });
    }

    const { confirmed, feedback, rejectionReason } = req.body || {};

    if (confirmed === false || confirmed === "no") {
      // Reporter Rejected -> REOPENED
      bug.status = "REOPENED";
      bug.verification = {
        reporterConfirmed: false,
        confirmedAt: new Date(),
        rejectionReason: String(rejectionReason || feedback || "Issue still persists.").trim(),
      };
      bug.lastActivity = new Date();
      await bug.save();

      await logBugEvent(
        bug._id,
        req,
        "REPORTER_REJECTED",
        `Reporter ${getUserName(req)} rejected the fix. Bug reopened. Reason: ${bug.verification.rejectionReason}`
      );

      // Notify developer
      void createNotification({
        actor: getUserName(req),
        actorRole: getUserRole(req),
        action: "rejected resolution and reopened",
        resourceType: "bug",
        resourceName: bug.title,
        details: bug.verification.rejectionReason,
        resourceId: String(bug._id),
        assignees: [bug.assignedDeveloperName],
      });

      return res.json({ item: withId(bug) });
    }

    // Reporter Confirmed -> CLOSED_VERIFIED
    bug.status = "CLOSED_VERIFIED";
    bug.verification = {
      reporterConfirmed: true,
      confirmedAt: new Date(),
      feedback: String(feedback || "Verified and confirmed fix.").trim(),
    };
    bug.lastActivity = new Date();
    await bug.save();

    await logBugEvent(
      bug._id,
      req,
      "REPORTER_CONFIRMED",
      `Reporter ${getUserName(req)} verified the fix. Bug closed.`
    );

    // Notify developer
    void createNotification({
      actor: getUserName(req),
      actorRole: getUserRole(req),
      action: "verified and closed",
      resourceType: "bug",
      resourceName: bug.title,
      details: bug.verification.feedback,
      resourceId: String(bug._id),
      assignees: [bug.assignedDeveloperName],
    });

    return res.json({ item: withId(bug) });
  } catch (err) {
    return next(err);
  }
});

// Request Information (NEEDS_INFO)
router.post("/:id/request-info", requireAuth, async (req, res, next) => {
  try {
    const bug = await BugReport.findById(req.params.id);
    if (!bug) return res.status(404).json({ error: { message: "Bug report not found" } });

    const note = String(req.body?.note || "").trim();
    bug.status = "NEEDS_INFO";
    bug.lastActivity = new Date();
    await bug.save();

    await logBugEvent(bug._id, req, "INFO_REQUESTED", `Developer requested more info: ${note}`);

    void createNotification({
      actor: getUserName(req),
      actorRole: getUserRole(req),
      action: "requested info on",
      resourceType: "bug",
      resourceName: bug.title,
      details: note,
      resourceId: String(bug._id),
      assignees: [bug.createdByUsername],
    });

    return res.json({ item: withId(bug) });
  } catch (err) {
    return next(err);
  }
});

// Admin Force Close Override
router.post("/:id/admin-override", requireAuth, async (req, res, next) => {
  try {
    const role = getUserRole(req);
    if (!["admin", "super-admin"].includes(role)) {
      return res.status(403).json({ error: { message: "Admin override requires admin privileges." } });
    }

    const bug = await BugReport.findById(req.params.id);
    if (!bug) return res.status(404).json({ error: { message: "Bug report not found" } });

    const reason = String(req.body?.reason || "Admin override close").trim();
    bug.status = "CLOSED_ADMIN_OVERRIDE";
    bug.lastActivity = new Date();
    await bug.save();

    await logBugEvent(bug._id, req, "ADMIN_OVERRIDE", `Admin ${getUserName(req)} override closed the bug. Reason: ${reason}`);

    return res.json({ item: withId(bug) });
  } catch (err) {
    return next(err);
  }
});

// ----------------------------------------------------
// AUDIT TRAIL / ACTIVITY LOG APIs
// ----------------------------------------------------

router.get("/:id/events", requireAuth, async (req, res, next) => {
  try {
    const events = await BugEvent.find({ bugId: req.params.id }).sort({ createdAt: -1 }).lean();
    return res.json({ items: events.map(withId) });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
