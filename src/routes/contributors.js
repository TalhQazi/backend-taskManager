const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const { requireAuth, requireRole, requireSuperAdmin, requireAdmin, requireManager } = require("../middleware/auth");
const Contributor = require("../models/Contributor");
const Contribution = require("../models/Contribution");
const Task = require("../models/Task");
const Project = require("../models/Project");
const User = require("../models/User");
const contributionTracker = require("../utils/contributionTracker");

// Get all contributors (Admin/Manager only)
router.get("/", requireAuth, requireManager, async (req, res) => {
  try {
    const { search, role, projectId, limit = 20, page = 1 } = req.query;

    const query = { status: "active" };
    if (role) query.role = role;
    if (projectId) query["projects.projectId"] = projectId;

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    let [contributors, total] = await Promise.all([
      Contributor.find(query)
        .sort({ "stats.totalTasksCompleted": -1, "stats.lastContributionAt": -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Contributor.countDocuments(query),
    ]);

    // Populate missing names from User collection
    const userIdsWithoutNames = contributors
      .filter(c => !c.name || c.name === "Unknown")
      .map(c => c.userId);

    if (userIdsWithoutNames.length > 0) {
      const users = await User.find({ _id: { $in: userIdsWithoutNames } }).lean();
      const userMap = new Map(users.map(u => [String(u._id), u]));

      contributors = contributors.map(c => {
        if (!c.name || c.name === "Unknown") {
          const user = userMap.get(c.userId);
          if (user) {
            c.name = user.name || user.username || user.email?.split('@')[0] || "Unknown";
            c.email = c.email || user.email || "";
          }
        }
        return c;
      });
    }

    res.json({
      items: contributors,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / parseInt(limit)),
    });
  } catch (error) {
    console.error("[Contributors API] Error fetching contributors:", error);
    res.status(500).json({ error: "Failed to fetch contributors" });
  }
});

// Get top contributors
router.get("/top", requireAuth, async (req, res) => {
  try {
    const { limit = 10, projectId, role } = req.query;

    const filters = { status: "active" };
    if (projectId) filters.projectId = projectId;
    if (role) filters.role = role;

    let contributors = await Contributor.find(filters)
      .sort({ "stats.totalTasksCompleted": -1, "stats.lastContributionAt": -1 })
      .limit(parseInt(limit))
      .lean();

    // Populate missing names from User collection
    const userIdsWithoutNames = contributors
      .filter(c => !c.name || c.name === "Unknown")
      .map(c => c.userId);

    if (userIdsWithoutNames.length > 0) {
      const users = await User.find({ _id: { $in: userIdsWithoutNames } }).lean();
      const userMap = new Map(users.map(u => [String(u._id), u]));

      contributors = contributors.map(c => {
        if (!c.name || c.name === "Unknown") {
          const user = userMap.get(c.userId);
          if (user) {
            c.name = user.name || user.username || user.email?.split('@')[0] || "Unknown";
            c.email = c.email || user.email || "";
          }
        }
        return c;
      });
    }

    res.json({
      items: contributors,
      total: contributors.length,
    });
  } catch (error) {
    console.error("[Contributors API] Error fetching top contributors:", error);
    res.status(500).json({ error: "Failed to fetch top contributors" });
  }
});

// Get single contributor details
router.get("/:userId", requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;

    const contributor = await Contributor.findOne({ userId }).lean();
    if (!contributor) {
      return res.status(404).json({ error: "Contributor not found" });
    }

    // Get recent contributions
    const recentContributions = await Contribution.find({ contributorId: userId })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    // Get tasks worked on
    const tasksWorkedOn = await Task.find({
      "contributors.userId": userId,
    })
      .select("title status priority projectId contributors createdAt")
      .sort({ updatedAt: -1 })
      .limit(10)
      .lean();

    res.json({
      contributor,
      recentContributions,
      tasksWorkedOn,
    });
  } catch (error) {
    console.error("[Contributors API] Error fetching contributor:", error);
    res.status(500).json({ error: "Failed to fetch contributor details" });
  }
});

// Get contributions for a specific contributor
router.get("/:userId/contributions", requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const { resourceType, action, from, to, limit = 20, page = 1 } = req.query;

    const query = { contributorId: userId };

    if (resourceType) query.resourceType = resourceType;
    if (action) query.action = action;
    if (from || to) {
      query.createdAt = {};
      if (from) query.createdAt.$gte = new Date(from);
      if (to) query.createdAt.$lte = new Date(to);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [contributions, total] = await Promise.all([
      Contribution.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Contribution.countDocuments(query),
    ]);

    res.json({
      items: contributions,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / parseInt(limit)),
    });
  } catch (error) {
    console.error("[Contributors API] Error fetching contributions:", error);
    res.status(500).json({ error: "Failed to fetch contributions" });
  }
});

// Get contributions for a specific task
router.get("/task/:taskId", requireAuth, async (req, res) => {
  try {
    const { taskId } = req.params;
    const { limit = 50 } = req.query;

    if (!mongoose.Types.ObjectId.isValid(taskId)) {
      return res.status(400).json({ error: "Invalid task ID" });
    }

    const contributions = await contributionTracker.getTaskContributionHistory(
      taskId,
      parseInt(limit)
    );

    res.json({
      items: contributions,
      total: contributions.length,
    });
  } catch (error) {
    console.error("[Contributors API] Error fetching task contributions:", error);
    res.status(500).json({ error: "Failed to fetch task contributions" });
  }
});

// Get contributors for a specific task
router.get("/task/:taskId/contributors", requireAuth, async (req, res) => {
  try {
    const { taskId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(taskId)) {
      return res.status(400).json({ error: "Invalid task ID" });
    }

    const contributors = await contributionTracker.getTaskContributors(taskId);

    // Enrich with full profile info
    const enrichedContributors = await Promise.all(
      contributors.map(async (c) => {
        const profile = await Contributor.findOne({ userId: c.userId }).lean();
        return {
          ...c,
          avatar: profile?.avatar || "",
          department: profile?.department || "",
          stats: profile?.stats || {},
        };
      })
    );

    res.json({
      items: enrichedContributors,
      total: enrichedContributors.length,
    });
  } catch (error) {
    console.error("[Contributors API] Error fetching task contributors:", error);
    res.status(500).json({ error: "Failed to fetch task contributors" });
  }
});

// Get contributors for a specific project
router.get("/project/:projectId", requireAuth, async (req, res) => {
  try {
    const { projectId } = req.params;

    const contributors = await contributionTracker.getProjectContributors(projectId);

    res.json({
      items: contributors,
      total: contributors.length,
    });
  } catch (error) {
    console.error("[Contributors API] Error fetching project contributors:", error);
    res.status(500).json({ error: "Failed to fetch project contributors" });
  }
});

// Get contribution timeline/stats for a project
router.get("/project/:projectId/stats", requireAuth, async (req, res) => {
  try {
    const { projectId } = req.params;
    const { from, to } = req.query;

    const matchStage = { projectId, resourceType: "task" };
    if (from || to) {
      matchStage.createdAt = {};
      if (from) matchStage.createdAt.$gte = new Date(from);
      if (to) matchStage.createdAt.$lte = new Date(to);
    }

    const stats = await Contribution.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: "$action",
          count: { $sum: 1 },
          contributors: { $addToSet: "$contributorId" },
        },
      },
      {
        $project: {
          action: "$_id",
          count: 1,
          uniqueContributors: { $size: "$contributors" },
        },
      },
    ]);

    // Get daily contribution counts
    const dailyStats = await Contribution.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    res.json({
      actionStats: stats,
      dailyStats,
      totalContributions: stats.reduce((sum, s) => sum + s.count, 0),
    });
  } catch (error) {
    console.error("[Contributors API] Error fetching project stats:", error);
    res.status(500).json({ error: "Failed to fetch project stats" });
  }
});

// Search contributors
router.get("/search/:term", requireAuth, async (req, res) => {
  try {
    const { term } = req.params;
    const { role, projectId, limit = 20 } = req.query;

    const filters = {};
    if (role) filters.role = role;
    if (projectId) filters.projectId = projectId;

    const contributors = await contributionTracker.searchContributors(term, filters, parseInt(limit));

    res.json({
      items: contributors,
      total: contributors.length,
    });
  } catch (error) {
    console.error("[Contributors API] Error searching contributors:", error);
    res.status(500).json({ error: "Failed to search contributors" });
  }
});

// Get contribution dashboard stats (Admin only)
router.get("/stats/dashboard", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { from, to } = req.query;

    const dateFilter = {};
    if (from || to) {
      dateFilter.createdAt = {};
      if (from) dateFilter.createdAt.$gte = new Date(from);
      if (to) dateFilter.createdAt.$lte = new Date(to);
    }

    const [
      totalContributors,
      activeContributors,
      totalContributions,
      topContributors,
      actionDistribution,
    ] = await Promise.all([
      Contributor.countDocuments(),
      Contributor.countDocuments({ status: "active" }),
      Contribution.countDocuments(dateFilter),
      Contributor.find()
        .sort({ "stats.totalTasksCompleted": -1 })
        .limit(5)
        .lean(),
      Contribution.aggregate([
        { $match: dateFilter },
        { $group: { _id: "$action", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
    ]);

    res.json({
      totalContributors,
      activeContributors,
      totalContributions,
      topContributors,
      actionDistribution,
    });
  } catch (error) {
    console.error("[Contributors API] Error fetching dashboard stats:", error);
    res.status(500).json({ error: "Failed to fetch dashboard stats" });
  }
});

module.exports = router;
