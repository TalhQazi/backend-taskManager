const express = require("express");
const ActivityLog = require("../models/ActivityLog");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

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
      limit = 50,
      skip = 0,
    } = req.query;

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

    // Get total count for pagination
    const totalCount = await ActivityLog.countDocuments(filter);
    
    // Get logs with pagination
    const logs = await ActivityLog.find(filter)
      .sort({ createdAt: -1 })
      .skip(Number(skip))
      .limit(Number(limit))
      .lean();

    res.json({
      items: logs.map((log) => ({
        id: String(log._id),
        actorUserId: log.actorUserId,
        actorUsername: log.actorUsername,
        actorRole: log.actorRole,
        action: log.action,
        resourceType: log.resourceType,
        resourceId: log.resourceId,
        resourceName: log.resourceName,
        description: log.description,
        ipAddress: log.ipAddress,
        userAgent: log.userAgent,
        metadata: log.metadata,
        createdAt: log.createdAt,
      })),
      pagination: {
        total: totalCount,
        limit: Number(limit),
        skip: Number(skip),
        hasMore: totalCount > Number(skip) + Number(limit),
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/activity-logs/actions - Get all unique actions (for filtering)
router.get("/actions", requireAuth, requireRole(["super-admin", "admin"]), async (_req, res, next) => {
  try {
    const actions = await ActivityLog.distinct("action");
    res.json({ actions });
  } catch (err) {
    next(err);
  }
});

// GET /api/activity-logs/resource-types - Get all unique resource types (for filtering)
router.get("/resource-types", requireAuth, requireRole(["super-admin", "admin"]), async (_req, res, next) => {
  try {
    const resourceTypes = await ActivityLog.distinct("resourceType");
    res.json({ resourceTypes });
  } catch (err) {
    next(err);
  }
});

// GET /api/activity-logs/summary - Get activity summary/stats
router.get("/summary", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const { from, to } = req.query;
    
    const matchStage = {};
    matchStage.actorRole = { $ne: "super-admin" };
    if (from || to) {
      matchStage.createdAt = {};
      if (from) matchStage.createdAt.$gte = new Date(from);
      if (to) matchStage.createdAt.$lte = new Date(to);
    }

    // Get counts by action
    const actionCounts = await ActivityLog.aggregate([
      { $match: matchStage },
      { $group: { _id: "$action", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    // Get counts by resource type
    const resourceTypeCounts = await ActivityLog.aggregate([
      { $match: matchStage },
      { $group: { _id: "$resourceType", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    // Get most active users
    const topUsers = await ActivityLog.aggregate([
      { $match: matchStage },
      { $group: { _id: "$actorUsername", count: { $sum: 1 }, role: { $first: "$actorRole" } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);

    // Get total count
    const totalCount = await ActivityLog.countDocuments(matchStage);

    res.json({
      totalCount,
      actionCounts: actionCounts.map((a) => ({ action: a._id, count: a.count })),
      resourceTypeCounts: resourceTypeCounts.map((r) => ({ resourceType: r._id, count: r.count })),
      topUsers: topUsers.map((u) => ({ username: u._id, role: u.role, count: u.count })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
