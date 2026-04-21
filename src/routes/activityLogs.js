const express = require("express");
const ActivityLog = require("../models/ActivityLog");
const { requireAuth, requireRole } = require("../middleware/auth");
const { parsePagination, paginatedResponse } = require("../lib/pagination");
const { cacheWrap } = require("../lib/cache");

const router = express.Router();

const LOG_LIST_PROJECTION = {
  actorUserId: 1,
  actorUsername: 1,
  actorRole: 1,
  action: 1,
  resourceType: 1,
  resourceId: 1,
  resourceName: 1,
  description: 1,
  ipAddress: 1,
  metadata: 1,
  createdAt: 1,
};

// GET /api/activity-logs - Get all activity logs
router.get("/", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const {
      userId,
      username,
      action,
      resourceType,
      from,
      to,
    } = req.query;
    
    const { page, limit, skip } = parsePagination(req.query);

    // Build filter object
    const filter = {};

    // By default, hide super-admin activity (can be overridden by explicitly filtering to super-admin)
    if (!userId && !username) {
      filter.actorRole = { $ne: "super-admin" };
    }
    
    if (userId) {
      filter.actorUserId = userId;
    }
    
    if (username) {
      filter.actorUsername = { $regex: username, $options: "i" };
    }
    
    if (action) {
      filter.action = action;
    }
    
    if (resourceType) {
      filter.resourceType = resourceType;
    }
    
    // Date range filter
    if (from || to) {
      filter.createdAt = {};
      if (from) {
        filter.createdAt.$gte = new Date(from);
      }
      if (to) {
        filter.createdAt.$lte = new Date(to);
      }
    }

    const cacheKey = `activity-logs:list:${userId || 'all'}:${username || 'any'}:${action || 'any'}:${resourceType || 'any'}:p${page}:l${limit}:${from || 'f'}:${to || 't'}`;
    
    const result = await cacheWrap(cacheKey, async () => {
      const [logs, totalCount] = await Promise.all([
        ActivityLog.find(filter, LOG_LIST_PROJECTION)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        ActivityLog.countDocuments(filter)
      ]);

      const items = logs.map((log) => ({
        id: String(log._id),
        ...log
      }));

      return paginatedResponse(items, totalCount, page, limit);
    }, 5); // Very short cache for activity logs (5s)

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/activity-logs/actions - Get all unique actions (for filtering)
router.get("/actions", requireAuth, requireRole(["super-admin", "admin"]), async (_req, res, next) => {
  try {
    const actions = await cacheWrap('activity-logs:actions', () => ActivityLog.distinct("action"), 300);
    res.json({ actions });
  } catch (err) {
    next(err);
  }
});

// GET /api/activity-logs/resource-types - Get all unique resource types (for filtering)
router.get("/resource-types", requireAuth, requireRole(["super-admin", "admin"]), async (_req, res, next) => {
  try {
    const resourceTypes = await cacheWrap('activity-logs:resource-types', () => ActivityLog.distinct("resourceType"), 300);
    res.json({ resourceTypes });
  } catch (err) {
    next(err);
  }
});

// GET /api/activity-logs/summary - Get activity summary/stats
router.get("/summary", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const { from, to } = req.query;
    const cacheKey = `activity-logs:summary:${from || 'f'}:${to || 't'}`;
    
    const result = await cacheWrap(cacheKey, async () => {
      const matchStage = {};
      matchStage.actorRole = { $ne: "super-admin" };
      if (from || to) {
        matchStage.createdAt = {};
        if (from) matchStage.createdAt.$gte = new Date(from);
        if (to) matchStage.createdAt.$lte = new Date(to);
      }

      const [actionCounts, resourceTypeCounts, topUsers, totalCount] = await Promise.all([
        ActivityLog.aggregate([
          { $match: matchStage },
          { $group: { _id: "$action", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]),
        ActivityLog.aggregate([
          { $match: matchStage },
          { $group: { _id: "$resourceType", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]),
        ActivityLog.aggregate([
          { $match: matchStage },
          { $group: { _id: "$actorUsername", count: { $sum: 1 }, role: { $first: "$actorRole" } } },
          { $sort: { count: -1 } },
          { $limit: 10 },
        ]),
        ActivityLog.countDocuments(matchStage)
      ]);

      return {
        totalCount,
        actionCounts: actionCounts.map((a) => ({ action: a._id, count: a.count })),
        resourceTypeCounts: resourceTypeCounts.map((r) => ({ resourceType: r._id, count: r.count })),
        topUsers: topUsers.map((u) => ({ username: u._id, role: u.role, count: u.count })),
      };
    }, 60);

    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
