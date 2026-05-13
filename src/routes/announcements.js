const express = require("express");
const mongoose = require("mongoose");
const Announcement = require("../models/Announcement");
const AnnouncementTarget = require("../models/AnnouncementTarget");
const AnnouncementRead = require("../models/AnnouncementRead");
const AnnouncementAcknowledgement = require("../models/AnnouncementAcknowledgement");
const Employee = require("../models/Employee");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

function getActorUserId(req) {
  return String(req.user?.sub || req.user?.id || req.user?._id || req.user?.username || "").trim();
}

function canManageAnnouncements(role) {
  return ["super-admin", "admin", "manager", "team-lead"].includes(String(role || ""));
}

function isPrivilegedAdmin(role) {
  return ["super-admin", "admin"].includes(String(role || ""));
}

function activeAnnouncementMatch() {
  return {
    status: "active",
    $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
  };
}

function normalize(s) {
  return String(s || "").trim().toLowerCase();
}

async function isUserEligible(userId, userRecord, targets, viewerRole) {
  if (isPrivilegedAdmin(viewerRole)) return true;
  if (!targets || targets.length === 0) return true;
  if (targets.some((t) => (t.targetType || "global") === "global")) return true;

  const uid = normalize(userId);
  const email = normalize(userRecord?.email);
  const username = normalize(userRecord?.username || userRecord?.email);
  const role = normalize(userRecord?.userRole || userRecord?.role);
  const dept = normalize(userRecord?.department);
  const loc = normalize(userRecord?.location);
  const company = normalize(userRecord?.company);

  for (const t of targets) {
    const type = String(t.targetType || "global").toLowerCase();
    const tid = normalize(t.targetId);
    const tlab = normalize(t.targetLabel);

    if (type === "user") {
      if (tid && (tid === uid || tid === email || tid === username)) return true;
    } else if (type === "role") {
      if (tid && (tid === role || tid === normalize(t.targetLabel))) return true;
    } else if (type === "department" || type === "team") {
      if (tid && dept && (tid === dept || tid === tlab)) return true;
    } else if (type === "location") {
      if (tid && loc && (tid === loc || tid === tlab)) return true;
    } else if (type === "company") {
      if (!tid || tid === company || tlab === company) return true;
    }
  }
  return false;
}

function toItem(doc, extras = {}) {
  const o = doc.toObject ? doc.toObject() : { ...doc };
  return {
    ...o,
    id: String(o._id),
    ...extras,
  };
}

async function loadTargetsForMany(ids) {
  if (!ids.length) return new Map();
  const targets = await AnnouncementTarget.find({ announcementId: { $in: ids } }).lean();
  const map = new Map();
  for (const t of targets) {
    const k = String(t.announcementId);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(t);
  }
  return map;
}

async function enrichForUser(announcements, userId) {
  const ids = announcements.map((a) => a._id);
  const [reads, acks, targetsMap] = await Promise.all([
    ids.length
      ? AnnouncementRead.find({ announcementId: { $in: ids }, userId }).lean()
      : [],
    ids.length
      ? AnnouncementAcknowledgement.find({ announcementId: { $in: ids }, userId }).lean()
      : [],
    loadTargetsForMany(ids),
  ]);
  const readSet = new Set(reads.map((r) => String(r.announcementId)));
  const ackSet = new Set(acks.map((r) => String(r.announcementId)));

  const readCounts = await Promise.all(
    ids.map((id) => AnnouncementRead.countDocuments({ announcementId: id }))
  );
  const ackCounts = await Promise.all(
    ids.map((id) => AnnouncementAcknowledgement.countDocuments({ announcementId: id }))
  );

  return announcements.map((a, i) => {
    const id = String(a._id);
    const targets = targetsMap.get(id) || [];
    const readCount = readCounts[i] || 0;
    const ackCount = ackCounts[i] || 0;
    const denom = Math.max(a.sentCount || 0, readCount, 1);
    const readPercentage = Math.min(100, Math.round((readCount / denom) * 100));
    const acknowledgedPercentage = Math.min(100, Math.round((ackCount / Math.max(denom, 1)) * 100));
    return toItem(a, {
      targets,
      isRead: readSet.has(id),
      isAcknowledged: ackSet.has(id),
      readPercentage,
      acknowledgedPercentage,
    });
  });
}

// ─── GET /api/announcements/unread-count ─────────────────────────────────────
router.get("/unread-count", requireAuth, async (req, res) => {
  try {
    const userId = getActorUserId(req);
    const viewerRole = String(req.user?.role || "");
    const items = await Announcement.find(activeAnnouncementMatch())
      .sort({ pinned: -1, createdAt: -1 })
      .limit(500)
      .lean();

    const userRecord = await Employee.findOne({
      $or: [{ _id: userId }, { email: userId }, { username: userId }],
    })
      .select("_id email username role userRole department location company")
      .lean();

    const ids = items.map((a) => a._id);
    const targetsMap = await loadTargetsForMany(ids);
    const reads = ids.length
      ? await AnnouncementRead.find({ announcementId: { $in: ids }, userId }).select("announcementId").lean()
      : [];
    const readSet = new Set(reads.map((r) => String(r.announcementId)));

    let unread = 0;
    for (const a of items) {
      const targets = targetsMap.get(String(a._id)) || [];
      // eslint-disable-next-line no-await-in-loop
      const ok = await isUserEligible(userId, userRecord, targets, viewerRole);
      if (ok && !readSet.has(String(a._id))) unread += 1;
    }
    res.json({ unread });
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// ─── GET /api/announcements ──────────────────────────────────────────────────
router.get("/", requireAuth, async (req, res) => {
  try {
    const userId = getActorUserId(req);
    const viewerRole = String(req.user?.role || "");
    const tabKey = String(req.query.tab || req.query.filter || "all").toLowerCase();
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "20"), 10) || 20));
    const skip = (page - 1) * limit;

    const userRecord = await Employee.findOne({
      $or: [{ _id: userId }, { email: userId }, { username: userId }],
    })
      .select("_id email username role userRole department location company")
      .lean();

    if (canManageAnnouncements(viewerRole)) {
      const match = {};
      if (tabKey === "active") Object.assign(match, activeAnnouncementMatch());
      else if (tabKey === "archived") match.status = "archived";
      else if (tabKey === "emergency") {
        Object.assign(match, activeAnnouncementMatch());
        match.emergency = true;
      } else if (tabKey === "important") {
        Object.assign(match, activeAnnouncementMatch());
        match.priority = { $in: ["high", "critical"] };
      } else {
        match.status = { $ne: "archived" };
      }

      if (req.query.priority && req.query.priority !== "all") match.priority = String(req.query.priority);
      if (req.query.category && req.query.category !== "all") match.category = String(req.query.category);
      if (req.query.author) {
        match.authorName = { $regex: new RegExp(String(req.query.author).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") };
      }
      if (req.query.dateFrom || req.query.dateTo) {
        match.createdAt = {};
        if (req.query.dateFrom) match.createdAt.$gte = new Date(req.query.dateFrom);
        if (req.query.dateTo) match.createdAt.$lte = new Date(req.query.dateTo);
      }

      if (tabKey === "unread") {
        const rawAll = await Announcement.find(match).sort({ pinned: -1, createdAt: -1 }).limit(800).lean();
        let items = await enrichForUser(rawAll, userId);
        items = items.filter((x) => !x.isRead);
        const total = items.length;
        const pageItems = items.slice(skip, skip + limit);
        return res.json({ items: pageItems, total, page, limit });
      }

      const [rawItems, total] = await Promise.all([
        Announcement.find(match).sort({ pinned: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
        Announcement.countDocuments(match),
      ]);

      const items = await enrichForUser(rawItems, userId);
      return res.json({ items, total, page, limit });
    }

    // Employee / other roles: only active, eligible
    const rawItems = await Announcement.find(activeAnnouncementMatch())
      .sort({ pinned: -1, createdAt: -1 })
      .limit(800)
      .lean();

    const ids = rawItems.map((a) => a._id);
    const targetsMap = await loadTargetsForMany(ids);
    const eligible = [];
    for (const a of rawItems) {
      const targets = targetsMap.get(String(a._id)) || [];
      // eslint-disable-next-line no-await-in-loop
      if (await isUserEligible(userId, userRecord, targets, viewerRole)) eligible.push(a);
    }

    let items = await enrichForUser(eligible, userId);

    if (tabKey === "unread") items = items.filter((x) => !x.isRead);
    else if (tabKey === "important") items = items.filter((x) => x.priority === "high" || x.priority === "critical");
    else if (tabKey === "emergency") items = items.filter((x) => x.emergency);

    const total = items.length;
    const pageItems = items.slice(skip, skip + limit);
    res.json({ items: pageItems, total, page, limit });
  } catch (err) {
    console.error("[announcements] GET /", err);
    res.status(500).json({ error: { message: err.message } });
  }
});

// ─── POST /api/announcements ─────────────────────────────────────────────────
router.post("/", requireAuth, async (req, res) => {
  try {
    if (!canManageAnnouncements(req.user.role)) {
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
      sendSMS = false,
      repeatFrequency = "none",
      targets = [],
      attachments = [],
    } = req.body;

    if (!title || !body) {
      return res.status(400).json({ error: { message: "Title and body are required" } });
    }

    const targetSummary =
      !targets || targets.length === 0
        ? "Everyone"
        : targets.map((t) => t.targetLabel || t.targetId || t.targetType).join(", ");

    const announcement = await Announcement.create({
      title,
      body,
      authorId: getActorUserId(req),
      authorName: req.user.name || req.user.username || "",
      authorRole: req.user.role || "",
      priority,
      category,
      status: scheduledAt ? "scheduled" : status,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      pinned,
      emergency,
      requiresAcknowledgement,
      sendPushNotification,
      sendEmail,
      sendSMS,
      repeatFrequency,
      attachments,
      targetSummary,
      sentCount: 0,
    });

    if (targets && targets.length > 0) {
      await AnnouncementTarget.insertMany(
        targets.map((t) => ({
          announcementId: announcement._id,
          targetType: t.targetType || "global",
          targetId: t.targetId || "",
          targetLabel: t.targetLabel || t.targetId || "",
        }))
      );
    }

    if (global.io) {
      global.io.emit("new-announcement", {
        id: String(announcement._id),
        title: announcement.title,
        priority: announcement.priority,
        emergency: announcement.emergency,
      });
    }

    res.status(201).json({ item: toItem(announcement) });
  } catch (err) {
    console.error("[announcements] POST /", err);
    res.status(500).json({ error: { message: err.message } });
  }
});

// ─── PUT /api/announcements/:id ──────────────────────────────────────────────
router.put("/:id", requireAuth, async (req, res) => {
  try {
    if (!canManageAnnouncements(req.user.role)) {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }
    const { targets, ...rest } = req.body;
    if (rest.expiresAt) rest.expiresAt = new Date(rest.expiresAt);
    if (rest.scheduledAt) rest.scheduledAt = new Date(rest.scheduledAt);

    if (targets !== undefined) {
      rest.targetSummary =
        !targets || targets.length === 0
          ? "Everyone"
          : targets.map((t) => t.targetLabel || t.targetId || t.targetType).join(", ");
    }

    const item = await Announcement.findByIdAndUpdate(req.params.id, { $set: rest }, { new: true }).lean();
    if (!item) return res.status(404).json({ error: { message: "Not found" } });

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

    if (global.io) global.io.emit("announcement-updated", { id: String(item._id) });
    const targetsLoaded = await AnnouncementTarget.find({ announcementId: item._id }).lean();
    res.json({ item: { ...toItem(item), targets: targetsLoaded } });
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// ─── DELETE /api/announcements/:id ───────────────────────────────────────────
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    if (!canManageAnnouncements(req.user.role)) {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }
    const item = await Announcement.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ error: { message: "Not found" } });
    await Promise.all([
      AnnouncementTarget.deleteMany({ announcementId: item._id }),
      AnnouncementRead.deleteMany({ announcementId: item._id }),
      AnnouncementAcknowledgement.deleteMany({ announcementId: item._id }),
    ]);
    if (global.io) global.io.emit("announcement-deleted", { id: String(item._id) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// ─── GET /api/announcements/:id/analytics ───────────────────────────────────
router.get("/:id/analytics", requireAuth, async (req, res) => {
  try {
    if (!canManageAnnouncements(req.user.role)) {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }
    const announcement = await Announcement.findById(req.params.id).lean();
    if (!announcement) return res.status(404).json({ error: { message: "Not found" } });

    const [readCount, ackCount] = await Promise.all([
      AnnouncementRead.countDocuments({ announcementId: announcement._id }),
      AnnouncementAcknowledgement.countDocuments({ announcementId: announcement._id }),
    ]);
    const denom = Math.max(announcement.sentCount || 0, readCount, 1);
    const readPercentage = Math.min(100, Math.round((readCount / denom) * 100));
    const acknowledgedPercentage = Math.min(100, Math.round((ackCount / denom) * 100));

    const reads = await AnnouncementRead.find({ announcementId: announcement._id }).lean();
    res.json({
      announcement: toItem(announcement),
      userList: reads.map((r) => ({
        userId: r.userId,
        userName: r.userName,
        readAt: r.readAt,
      })),
      readPercentage,
      acknowledgedPercentage,
    });
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// ─── GET /api/announcements/:id (single) ─────────────────────────────────────
router.get("/:id", requireAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ error: { message: "Not found" } });
    }
    const a = await Announcement.findById(req.params.id).lean();
    if (!a) return res.status(404).json({ error: { message: "Not found" } });
    const userId = getActorUserId(req);
    const viewerRole = String(req.user?.role || "");
    const targets = await AnnouncementTarget.find({ announcementId: a._id }).lean();
    const userRecord = await Employee.findOne({
      $or: [{ _id: userId }, { email: userId }, { username: userId }],
    })
      .select("_id email username role userRole department location company")
      .lean();

    if (!(await isUserEligible(userId, userRecord, targets, viewerRole)) && !canManageAnnouncements(viewerRole)) {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }

    const [enriched] = await enrichForUser([a], userId);
    res.json({ item: { ...enriched, targets } });
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// ─── POST /api/announcements/:id/read ───────────────────────────────────────
router.post("/:id/read", requireAuth, async (req, res) => {
  try {
    const userId = getActorUserId(req);
    const announcementId = req.params.id;
    const a = await Announcement.findById(announcementId).lean();
    if (!a) return res.status(404).json({ error: { message: "Not found" } });

    const targets = await AnnouncementTarget.find({ announcementId: a._id }).lean();
    const userRecord = await Employee.findOne({
      $or: [{ _id: userId }, { email: userId }, { username: userId }],
    })
      .select("_id email username role userRole department location company")
      .lean();

    if (!(await isUserEligible(userId, userRecord, targets, String(req.user?.role || "")))) {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }

    await AnnouncementRead.findOneAndUpdate(
      { announcementId, userId },
      {
        $setOnInsert: {
          announcementId,
          userId,
          userName: req.user.name || req.user.username || "",
          userRole: req.user.role || "",
          readAt: new Date(),
        },
      },
      { upsert: true, new: true }
    );

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// ─── POST /api/announcements/:id/acknowledge ───────────────────────────────
router.post("/:id/acknowledge", requireAuth, async (req, res) => {
  try {
    const userId = getActorUserId(req);
    const announcementId = req.params.id;
    const a = await Announcement.findById(announcementId).lean();
    if (!a) return res.status(404).json({ error: { message: "Not found" } });

    const targets = await AnnouncementTarget.find({ announcementId: a._id }).lean();
    const userRecord = await Employee.findOne({
      $or: [{ _id: userId }, { email: userId }, { username: userId }],
    })
      .select("_id email username role userRole department location company")
      .lean();

    if (!(await isUserEligible(userId, userRecord, targets, String(req.user?.role || "")))) {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }

    await AnnouncementAcknowledgement.findOneAndUpdate(
      { announcementId, userId },
      {
        $setOnInsert: {
          announcementId,
          userId,
          userName: req.user.name || req.user.username || "",
          acknowledgedAt: new Date(),
        },
      },
      { upsert: true, new: true }
    );

    if (global.io) global.io.emit("announcement-acknowledged", { id: String(announcementId), userId });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// ─── POST /api/announcements/:id/pin ─────────────────────────────────────────
router.post("/:id/pin", requireAuth, async (req, res) => {
  try {
    if (!canManageAnnouncements(req.user.role)) {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }
    const pinned = Boolean(req.body?.pinned);
    const item = await Announcement.findByIdAndUpdate(req.params.id, { $set: { pinned } }, { new: true }).lean();
    if (!item) return res.status(404).json({ error: { message: "Not found" } });
    res.json({ item: toItem(item) });
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// ─── POST /api/announcements/:id/archive ───────────────────────────────────
router.post("/:id/archive", requireAuth, async (req, res) => {
  try {
    if (!canManageAnnouncements(req.user.role)) {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }
    const item = await Announcement.findByIdAndUpdate(
      req.params.id,
      { $set: { status: "archived" } },
      { new: true }
    ).lean();
    if (!item) return res.status(404).json({ error: { message: "Not found" } });
    res.json({ item: toItem(item) });
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

module.exports = router;
