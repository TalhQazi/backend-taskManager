const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Announcement = require("../models/Announcement");
const AnnouncementTarget = require("../models/AnnouncementTarget");
const AnnouncementRead = require("../models/AnnouncementRead");
const AnnouncementAcknowledgement = require("../models/AnnouncementAcknowledgement");
const AnnouncementGroup = require("../models/AnnouncementGroup");
const AnnouncementAuditLog = require("../models/AnnouncementAuditLog");
const Employee = require("../models/Employee");
const { 
  publishScheduledAnnouncements,
  expireAnnouncements,
  handleRecurringAnnouncements,
  runAllTasks
} = require("../lib/announcementScheduler");
const { requireAuth } = require("../middleware/auth");

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ADMIN_ROLES = ["super-admin", "admin", "manager", "team-lead"];

function isAdmin(role) {
  return ADMIN_ROLES.includes(String(role || "").toLowerCase().trim());
}

/** JWT payload uses `sub` (employee/user id); legacy may use id/_id/username */
function getActorUserId(req) {
  const u = req.user || {};
  return String(u.sub || u.id || u._id || u.username || "");
}

// Helper: Log audit event
async function logAuditEvent(announcementId, userId, userName, userRole, action, changes = {}, req) {
  try {
    await AnnouncementAuditLog.create({
      announcementId,
      userId,
      userName,
      userRole,
      action,
      changes,
      ipAddress: req?.ip || req?.connection?.remoteAddress || "",
      userAgent: req?.headers?.["user-agent"] || "",
    });
  } catch (err) {
    console.error("[announcements] Audit log error:", err);
    // Don't throw — audit logging should not block operations
  }
}

// Helper: Check if user is eligible to see this announcement
async function isUserEligible(userId, userRecord, announcement, targetList, viewerRole) {
  const normViewerRole = String(viewerRole || "").toLowerCase().trim();
  // Admins / managers / team-leads (JWT role) always see all non-draft announcements
  if (isAdmin(normViewerRole)) {
    return announcement.status !== "draft";
  }

  // If no targets specified, everyone sees it
  if (!targetList || targetList.length === 0) {
    return true;
  }

  const empRole = String(userRecord?.userRole || userRecord?.role || "").toLowerCase().trim();

  // Check if user matches any target
  for (const target of targetList) {
    const tType = String(target.targetType || "").toLowerCase().trim();
    if (tType === "global" || tType === "company") {
      return true;
    }

    if (tType === "user" && String(target.targetId || "").toLowerCase().trim() === String(userId || "").toLowerCase().trim()) {
      return true;
    }

    const tId = String(target.targetId || "").toLowerCase().trim();
    if (tType === "role" && (tId === empRole || tId === String(userRecord?.role || "").toLowerCase().trim())) {
      return true;
    }

    if (tType === "department" && tId === String(userRecord?.department || "").toLowerCase().trim()) {
      return true;
    }

    if (tType === "team" && (tId === String(userRecord?.team || "").toLowerCase().trim() || tId === String(userRecord?.department || "").toLowerCase().trim())) {
      return true;
    }

    if (tType === "location" && tId === String(userRecord?.location || "").toLowerCase().trim()) {
      return true;
    }
  }

  return false;
}

function buildMatchQuery(req) {
  const {
    status,
    priority,
    category,
    pinned,
    emergency,
    search,
    tab,
    filter,
    author,
    dateFrom,
    dateTo,
    location,
    team,
  } = req.query;

  const tabKey = String(tab || filter || "all");

  const match = {};

  if (status) match.status = status;
  if (priority) match.priority = priority;
  if (category) match.category = category;
  if (pinned === "true") match.pinned = true;
  if (emergency === "true") match.emergency = true;
  if (search) match.$text = { $search: search };

  if (author && String(author).trim()) {
    match.authorName = new RegExp(String(author).trim().replace(/[.*+?^${}()|[\]\\]/g, "\$&"), "i");
  }

  if (dateFrom || dateTo) {
    match.createdAt = {};
    if (dateFrom) match.createdAt.$gte = new Date(String(dateFrom));
    if (dateTo) {
      const end = new Date(String(dateTo));
      end.setHours(23, 59, 59, 999);
      match.createdAt.$lte = end;
    }
  }

  // Tab-based filters (unread handled after enrichment)
  if (tabKey === "important") match.priority = { $in: ["high", "critical"] };
  if (tabKey === "archived") match.status = "archived";
  if (tabKey === "emergency") match.emergency = true;
  if (tabKey === "active") {
    if (!status) match.status = { $in: ["active", "scheduled"] };
  } else if (tabKey === "mine" || tabKey === "unread") {
    if (!status && tabKey !== "archived") {
      match.status = { $in: ["active", "scheduled"] };
    }
  }
  // tabKey === "all" leaves match.status open so all announcements remain visible until deleted

  // Target hints for listing (optional): narrow by location/team label on targetSummary
  const locRx =
    location && String(location).trim()
      ? new RegExp(String(location).trim().replace(/[.*+?^${}()|[\]\\]/g, "\$&"), "i")
      : null;
  const teamRx =
    team && String(team).trim()
      ? new RegExp(String(team).trim().replace(/[.*+?^${}()|[\]\\]/g, "\$&"), "i")
      : null;
  if (locRx && teamRx) {
    match.$and = [{ targetSummary: locRx }, { targetSummary: teamRx }];
  } else if (locRx) {
    match.targetSummary = locRx;
  } else if (teamRx) {
    match.targetSummary = teamRx;
  }

  return match;
}

// ─── GET /api/announcements ───────────────────────────────────────────────────
// List all announcements (admin sees all, others see only ones targeting them)
router.get("/", requireAuth, async (req, res) => {
  try {
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 20);
    const skip = (page - 1) * limit;
    const userId = getActorUserId(req);
    const viewerRole = String(req.user?.role || "");

    const tabKey = String(req.query.tab || req.query.filter || "all");
    const match = buildMatchQuery(req);

    if (!isAdmin(viewerRole)) {
      match.status = "active";
    }

    if (tabKey === "mine") {
      match.authorId = userId;
    }

    const needWideFetch = !isAdmin(viewerRole) || tabKey === "unread";

    let items;
    if (needWideFetch) {
      items = await Announcement.find(match).sort({ pinned: -1, createdAt: -1 }).limit(800).lean();
    } else {
      items = await Announcement.find(match).sort({ pinned: -1, createdAt: -1 }).skip(skip).limit(limit).lean();
    }

    const queryConditions = [];
    if (mongoose.Types.ObjectId.isValid(userId)) {
      queryConditions.push({ _id: userId });
    }
    if (userId) {
      queryConditions.push({ username: userId });
      queryConditions.push({ email: userId });
    }

    const userRecord = queryConditions.length > 0
      ? await Employee.findOne({ $or: queryConditions })
          .select("_id username role userRole department team location")
          .lean()
      : null;

    const announcementIds = items.map((a) => a._id);
    const allTargets =
      announcementIds.length > 0
        ? await AnnouncementTarget.find({ announcementId: { $in: announcementIds } }).lean()
        : [];

    const targetsByAnnouncement = new Map();
    allTargets.forEach((t) => {
      const key = String(t.announcementId);
      if (!targetsByAnnouncement.has(key)) {
        targetsByAnnouncement.set(key, []);
      }
      targetsByAnnouncement.get(key).push(t);
    });

    const [reads, acks] =
      announcementIds.length > 0
        ? await Promise.all([
            AnnouncementRead.find({
              announcementId: { $in: announcementIds },
              userId,
            })
              .select("announcementId")
              .lean(),
            AnnouncementAcknowledgement.find({
              announcementId: { $in: announcementIds },
              userId,
            })
              .select("announcementId")
              .lean(),
          ])
        : [[], []];

    const readSet = new Set(reads.map((r) => String(r.announcementId)));
    const ackSet = new Set(acks.map((a) => String(a.announcementId)));

    const enriched = [];
    for (const a of items) {
      const targets = targetsByAnnouncement.get(String(a._id)) || [];
      const eligible = await isUserEligible(userId, userRecord, a, targets, viewerRole);

      const isExpired = a.expiresAt && new Date(a.expiresAt) < new Date();

      if (eligible && !isExpired) {
        enriched.push({
          ...a,
          id: String(a._id),
          isRead: readSet.has(String(a._id)),
          isAcknowledged: ackSet.has(String(a._id)),
          readPercentage:
            a.sentCount > 0 ? Math.round((a.readCount / a.sentCount) * 100) : 0,
          acknowledgedPercentage:
            a.sentCount > 0
              ? Math.round((a.acknowledgedCount / a.sentCount) * 100)
              : 0,
        });
      }
    }

    let filtered = enriched;
    if (tabKey === "unread") {
      filtered = enriched.filter((x) => !x.isRead);
    }

    const total = needWideFetch ? filtered.length : await Announcement.countDocuments(match);
    const pageItems = needWideFetch ? filtered.slice(skip, skip + limit) : filtered;

    res.json({ items: pageItems, total, page, limit });
  } catch (err) {
    console.error("[announcements] GET /", err);
    res.status(500).json({ error: { message: err.message } });
  }
});

// ─── GET /api/announcements/unread-count ─────────────────────────────────────
router.get("/unread-count", requireAuth, async (req, res) => {
  try {
    const userId = getActorUserId(req);
    const viewerRole = String(req.user?.role || "");

    const match = { status: "active", $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] };
    const items = await Announcement.find(match).sort({ pinned: -1, createdAt: -1 }).limit(500).lean();

    const queryConditions = [];
    if (mongoose.Types.ObjectId.isValid(userId)) {
      queryConditions.push({ _id: userId });
    }
    if (userId) {
      queryConditions.push({ username: userId });
      queryConditions.push({ email: userId });
    }

    const userRecord = queryConditions.length > 0
      ? await Employee.findOne({ $or: queryConditions })
          .select("_id username role userRole department team location")
          .lean()
      : null;

    const announcementIds = items.map((a) => a._id);
    const allTargets =
      announcementIds.length > 0
        ? await AnnouncementTarget.find({ announcementId: { $in: announcementIds } }).lean()
        : [];
    const targetsByAnnouncement = new Map();
    allTargets.forEach((t) => {
      const key = String(t.announcementId);
      if (!targetsByAnnouncement.has(key)) targetsByAnnouncement.set(key, []);
      targetsByAnnouncement.get(key).push(t);
    });

    const reads =
      announcementIds.length > 0
        ? await AnnouncementRead.find({ announcementId: { $in: announcementIds }, userId })
            .select("announcementId")
            .lean()
        : [];
    const readSet = new Set(reads.map((r) => String(r.announcementId)));

    let unread = 0;
    for (const a of items) {
      const targets = targetsByAnnouncement.get(String(a._id)) || [];
      const eligible = await isUserEligible(userId, userRecord, a, targets, viewerRole);
      if (eligible && !readSet.has(String(a._id))) unread += 1;
    }

    res.json({ unread });
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// ─── Groups API (before /:id routes) ──────────────────────────────────────────

// ─── GET /api/announcements/groups ───────────────────────────────────────────
router.get("/groups", requireAuth, async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }

    const { isActive = true } = req.query;
    const match = { isActive: isActive === "true" || isActive === true };

    const groups = await AnnouncementGroup.find(match)
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      groups: groups.map((g) => ({
        ...g,
        id: String(g._id),
      })),
    });
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// ─── POST /api/announcements/groups ──────────────────────────────────────────
router.post("/groups", requireAuth, async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }

    const {
      name,
      description = "",
      members = [],
      departments = [],
      teams = [],
      locations = [],
      roles = [],
      userIds = [],
    } = req.body;

    if (!name) {
      return res.status(400).json({ error: { message: "Name is required" } });
    }

    const group = await AnnouncementGroup.create({
      name,
      description,
      members,
      departments,
      teams,
      locations,
      roles,
      userIds,
      createdBy: getActorUserId(req),
      createdByName: req.user.name || req.user.username || "",
      memberCount: userIds.length + (members.includes("all-employees") ? 100 : 0),
    });

    res.status(201).json({
      group: { ...group.toObject(), id: String(group._id) },
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ error: { message: "Group name already exists" } });
    }
    res.status(500).json({ error: { message: err.message } });
  }
});

// ─── PUT /api/announcements/groups/:groupId ──────────────────────────────────
router.put("/groups/:groupId", requireAuth, async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }

    const updates = {
      ...req.body,
      lastModifiedBy: getActorUserId(req),
      lastModifiedAt: new Date(),
    };

    if (updates.userIds) {
      updates.memberCount = updates.userIds.length + (updates.members?.includes("all-employees") ? 100 : 0);
    }

    const group = await AnnouncementGroup.findByIdAndUpdate(
      req.params.groupId,
      { $set: updates },
      { new: true }
    ).lean();

    if (!group) {
      return res.status(404).json({ error: { message: "Group not found" } });
    }

    res.json({ group: { ...group, id: String(group._id) } });
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// ─── DELETE /api/announcements/groups/:groupId ───────────────────────────────
router.delete("/groups/:groupId", requireAuth, async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }

    const group = await AnnouncementGroup.findByIdAndDelete(req.params.groupId);
    if (!group) {
      return res.status(404).json({ error: { message: "Group not found" } });
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// ─── GET /api/announcements/:id ──────────────────────────────────────────────
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const item = await Announcement.findById(req.params.id).lean();
    if (!item) return res.status(404).json({ error: { message: "Not found" } });

    const userId = getActorUserId(req);

    const [targets, readRecord, ackRecord, totalReads, totalAcks] = await Promise.all([
      AnnouncementTarget.find({ announcementId: item._id }).lean(),
      AnnouncementRead.findOne({ announcementId: item._id, userId }).lean(),
      AnnouncementAcknowledgement.findOne({ announcementId: item._id, userId }).lean(),
      AnnouncementRead.countDocuments({ announcementId: item._id }),
      AnnouncementAcknowledgement.countDocuments({ announcementId: item._id }),
    ]);

    res.json({
      item: {
        ...item,
        id: String(item._id),
        targets,
        isRead: !!readRecord,
        isAcknowledged: !!ackRecord,
        totalReads,
        totalAcks,
        readPercentage:
          item.sentCount > 0 ? Math.round((totalReads / item.sentCount) * 100) : 0,
        acknowledgedPercentage:
          item.sentCount > 0 ? Math.round((totalAcks / item.sentCount) * 100) : 0,
      },
    });
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// ─── POST /api/announcements ──────────────────────────────────────────────────
router.post("/", requireAuth, async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }

    const {
      title,
      body,
      priority = "medium",
      category = "general",
      status = "active",
      scheduledAt,
      expiresAt,
      pinned = false,
      emergency = false,
      requiresAcknowledgement = false,
      sendPushNotification = true,
      sendEmail = false,
      repeatFrequency = "none",
      targets = [], // [{ targetType, targetId, targetLabel }]
      attachments = [],
    } = req.body;

    if (!title || !body) {
      return res.status(400).json({ error: { message: "Title and body are required" } });
    }

    const targetSummary =
      targets.length === 0
        ? "Everyone"
        : targets.map((t) => t.targetLabel || t.targetId || t.targetType).join(", ");

    const parseValidDate = (val) => {
      if (!val) return null;
      const d = new Date(val);
      return isNaN(d.getTime()) ? null : d;
    };

    const scheduledDate = parseValidDate(scheduledAt);
    const expiresDate = parseValidDate(expiresAt);

    const announcement = await Announcement.create({
      title,
      body,
      authorId: getActorUserId(req),
      authorName: req.user.name || req.user.username || "",
      authorRole: req.user.role || "",
      priority,
      category,
      status: scheduledDate ? "scheduled" : status,
      scheduledAt: scheduledDate,
      expiresAt: expiresDate,
      pinned,
      emergency,
      requiresAcknowledgement,
      sendPushNotification,
      sendEmail,
      repeatFrequency,
      attachments,
      targetSummary,
      sentCount: 0,
    });

    // Save targets
    if (targets.length > 0) {
      const targetDocs = targets.map((t) => ({
        announcementId: announcement._id,
        targetType: t.targetType || "global",
        targetId: t.targetId || "",
        targetLabel: t.targetLabel || t.targetId || "",
      }));
      await AnnouncementTarget.insertMany(targetDocs);
    }

    // Emit real-time Socket.io event
    if (global.io) {
      const payload = {
        id: String(announcement._id),
        title: announcement.title,
        priority: announcement.priority,
        emergency: announcement.emergency,
        authorName: announcement.authorName,
        createdAt: announcement.createdAt,
        targetSummary,
      };

      if (targets.length === 0 || targets.some((t) => t.targetType === "global")) {
        // Global broadcast
        global.io.emit("new-announcement", payload);
      } else {
        // Targeted rooms
        targets.forEach((t) => {
          if (t.targetType === "role" && t.targetId) {
            global.io.to(t.targetId).emit("new-announcement", payload);
          } else if (t.targetType === "user" && t.targetId) {
            global.io.to(t.targetId).emit("new-announcement", payload);
          } else {
            // department / team / location — broadcast to all for now
            global.io.emit("new-announcement", payload);
          }
        });
      }
    }

    res.status(201).json({ item: { ...announcement.toObject(), id: String(announcement._id) } });

    // Log audit event
    await logAuditEvent(
      announcement._id,
      getActorUserId(req),
      req.user.name || req.user.username || "",
      req.user.role || "",
      "created",
      { title, priority, category, targetSummary },
      req
    );
  } catch (err) {
    console.error("[announcements] POST /", err);
    res.status(500).json({ error: { message: err.message } });
  }
});

// ─── PUT /api/announcements/:id ──────────────────────────────────────────────
router.put("/:id", requireAuth, async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }

    const { targets, ...rest } = req.body;

    const parseValidDate = (val) => {
      if (!val) return null;
      const d = new Date(val);
      return isNaN(d.getTime()) ? null : d;
    };

    if (rest.expiresAt !== undefined) rest.expiresAt = parseValidDate(rest.expiresAt);
    if (rest.scheduledAt !== undefined) rest.scheduledAt = parseValidDate(rest.scheduledAt);
    if (rest.targets !== undefined) delete rest.targets;

    if (targets !== undefined) {
      rest.targetSummary =
        targets.length === 0
          ? "Everyone"
          : targets.map((t) => t.targetLabel || t.targetId || t.targetType).join(", ");
    }

    const item = await Announcement.findByIdAndUpdate(
      req.params.id,
      { $set: rest },
      { new: true }
    ).lean();

    if (!item) return res.status(404).json({ error: { message: "Not found" } });

    // Update targets if provided
    if (Array.isArray(targets)) {
      await AnnouncementTarget.deleteMany({ announcementId: item._id });
      if (targets.length > 0) {
        await AnnouncementTarget.insertMany(
          targets.map((t) => ({
            announcementId: item._id,
            targetType: t.targetType || "global",
            targetId: t.targetId || "",
            targetLabel: t.targetLabel || t.targetId || "",
          }))
        );
      }
    }

    if (global.io) {
      global.io.emit("announcement-updated", { id: String(item._id) });
    }

    // Log audit event
    await logAuditEvent(
      item._id,
      getActorUserId(req),
      req.user.name || req.user.username || "",
      req.user.role || "",
      "updated",
      rest,
      req
    );

    res.json({ item: { ...item, id: String(item._id) } });
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// ─── DELETE /api/announcements/:id ───────────────────────────────────────────
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }

    const item = await Announcement.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ error: { message: "Not found" } });

    // Clean up related docs
    await Promise.all([
      AnnouncementTarget.deleteMany({ announcementId: item._id }),
      AnnouncementRead.deleteMany({ announcementId: item._id }),
      AnnouncementAcknowledgement.deleteMany({ announcementId: item._id }),
    ]);

    // Log audit event
    await logAuditEvent(
      item._id,
      getActorUserId(req),
      req.user.name || req.user.username || "",
      req.user.role || "",
      "deleted",
      { title: item.title, priority: item.priority },
      req
    );

    if (global.io) {
      global.io.emit("announcement-deleted", { id: String(item._id) });
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// ─── POST /api/announcements/:id/read ────────────────────────────────────────
router.post("/:id/read", requireAuth, async (req, res) => {
  try {
    const userId = getActorUserId(req);
    const announcementId = req.params.id;

    // Upsert read record
    const result = await AnnouncementRead.findOneAndUpdate(
      { announcementId, userId },
      {
        $setOnInsert: {
          announcementId,
          userId,
          userName: req.user.name || req.user.username || "",
          userRole: req.user.role || "",
          readAt: new Date(),
          deviceType: req.body.deviceType || "desktop",
        },
      },
      { upsert: true, new: true }
    );

    // If newly created (first read), increment counter
    if (result) {
      await Announcement.findByIdAndUpdate(announcementId, {
        $inc: { readCount: 1 },
      });
    }

    res.json({ ok: true });
  } catch (err) {
    // Ignore duplicate key errors (already read)
    if (err.code === 11000) return res.json({ ok: true });
    res.status(500).json({ error: { message: err.message } });
  }
});

// ─── POST /api/announcements/:id/acknowledge ─────────────────────────────────
router.post("/:id/acknowledge", requireAuth, async (req, res) => {
  try {
    const userId = getActorUserId(req);
    const announcementId = req.params.id;
    const { confirmationText = "" } = req.body;

    await AnnouncementAcknowledgement.findOneAndUpdate(
      { announcementId, userId },
      {
        $setOnInsert: {
          announcementId,
          userId,
          userName: req.user.name || req.user.username || "",
          userRole: req.user.role || "",
          acknowledgedAt: new Date(),
          confirmationText,
        },
      },
      { upsert: true, new: true }
    );

    await Announcement.findByIdAndUpdate(announcementId, {
      $inc: { acknowledgedCount: 1 },
    });

    if (global.io) {
      global.io.to(announcementId).emit("announcement-acknowledged", {
        announcementId,
        userId,
        userName: req.user.name || req.user.username || "",
      });
    }

    res.json({ ok: true });
  } catch (err) {
    if (err.code === 11000) return res.json({ ok: true });
    res.status(500).json({ error: { message: err.message } });
  }
});

// ─── GET /api/announcements/:id/analytics ────────────────────────────────────
router.get("/:id/analytics", requireAuth, async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }

    const [reads, acks, announcement] = await Promise.all([
      AnnouncementRead.find({ announcementId: req.params.id })
        .sort({ readAt: -1 })
        .lean(),
      AnnouncementAcknowledgement.find({ announcementId: req.params.id })
        .sort({ acknowledgedAt: -1 })
        .lean(),
      Announcement.findById(req.params.id).select("sentCount readCount acknowledgedCount title").lean(),
    ]);

    const ackMap = new Map(acks.map((a) => [a.userId, a]));

    const userList = reads.map((r) => ({
      userId: r.userId,
      userName: r.userName,
      userRole: r.userRole,
      readAt: r.readAt,
      acknowledgedAt: ackMap.get(r.userId)?.acknowledgedAt || null,
      acknowledged: ackMap.has(r.userId),
    }));

    res.json({
      announcement,
      totalReads: reads.length,
      totalAcks: acks.length,
      readPercentage:
        announcement?.sentCount > 0
          ? Math.round((reads.length / announcement.sentCount) * 100)
          : 0,
      acknowledgedPercentage:
        announcement?.sentCount > 0
          ? Math.round((acks.length / announcement.sentCount) * 100)
          : 0,
      userList,
    });
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// ─── POST /api/announcements/:id/archive ─────────────────────────────────────
router.post("/:id/archive", requireAuth, async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }

    const item = await Announcement.findByIdAndUpdate(
      req.params.id,
      { $set: { status: "archived" } },
      { new: true }
    ).lean();

    if (!item) return res.status(404).json({ error: { message: "Not found" } });
    res.json({ item: { ...item, id: String(item._id) } });
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// ─── POST /api/announcements/:id/pin ─────────────────────────────────────────
router.post("/:id/pin", requireAuth, async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }
    const { pinned } = req.body;
    const item = await Announcement.findByIdAndUpdate(
      req.params.id,
      { $set: { pinned: Boolean(pinned) } },
      { new: true }
    ).lean();
    if (!item) return res.status(404).json({ error: { message: "Not found" } });
    res.json({ item: { ...item, id: String(item._id) } });
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// ─── GET /api/announcements/:id/audit-log ────────────────────────────────────
router.get("/:id/audit-log", requireAuth, async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }

    const logs = await AnnouncementAuditLog.find({
      announcementId: req.params.id,
    })
      .sort({ createdAt: -1 })
      .lean();

    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// ─── Scheduler Management (Admin Only) ────────────────────────────────────────

// ─── POST /api/announcements/scheduler/run ────────────────────────────────────
router.post("/scheduler/run", requireAuth, async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }

    const results = await runAllTasks();
    res.json({
      ok: true,
      message: "Scheduler tasks completed",
      results,
    });
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// ─── POST /api/announcements/scheduler/publish-scheduled ─────────────────────
router.post("/scheduler/publish-scheduled", requireAuth, async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }

    const result = await publishScheduledAnnouncements();
    res.json({
      ok: true,
      message: "Scheduled announcements published",
      result,
    });
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// ─── POST /api/announcements/scheduler/expire ─────────────────────────────────
router.post("/scheduler/expire", requireAuth, async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }

    const result = await expireAnnouncements();
    res.json({
      ok: true,
      message: "Expired announcements archived",
      result,
    });
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// ─── POST /api/announcements/scheduler/handle-recurring ──────────────────────
router.post("/scheduler/handle-recurring", requireAuth, async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }

    const result = await handleRecurringAnnouncements();
    res.json({
      ok: true,
      message: "Recurring announcements processed",
      result,
    });
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

module.exports = router;
