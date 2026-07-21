const express = require("express");
const Task = require("../models/Task");
const EmployeeCapacity = require("../models/EmployeeCapacity");
const { requireAuth } = require("../middleware/auth");
const { cacheWrap } = require("../lib/cache");

const router = express.Router();

const ACTIVE = ["pending", "in-progress", "overdue"];

/** Executive summary: status mix, overdue, throughput, priority mix. */
router.get("/summary", requireAuth, async (req, res, next) => {
  try {
    const result = await cacheWrap("task-analytics:summary", async () => {
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const [byStatus, byPriority, total, overdue, completedWeek, throughput] = await Promise.all([
        Task.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
        Task.aggregate([{ $group: { _id: "$priority", count: { $sum: 1 } } }]),
        Task.countDocuments({}),
        Task.countDocuments({ status: { $ne: "completed" }, dueDate: { $lt: now, $ne: null } }),
        Task.countDocuments({ status: "completed", completedAt: { $gte: weekAgo } }),
        Task.aggregate([
          { $match: { status: "completed", completedAt: { $gte: weekAgo } } },
          { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$completedAt" } }, count: { $sum: 1 } } },
          { $sort: { _id: 1 } },
        ]),
      ]);

      const statusMap = Object.fromEntries(byStatus.map((s) => [s._id || "unknown", s.count]));
      const completed = statusMap.completed || 0;
      return {
        total,
        overdue,
        completedThisWeek: completedWeek,
        onTimePct: total > 0 ? Math.round(((total - overdue) / total) * 100) : 100,
        completionPct: total > 0 ? Math.round((completed / total) * 100) : 0,
        byStatus: statusMap,
        byPriority: Object.fromEntries(byPriority.map((p) => [p._id || "unknown", p.count])),
        throughput: throughput.map((t) => ({ date: t._id, count: t.count })),
      };
    }, 30);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** Column counts for the Kanban header (cheap, no rows shipped). */
router.get("/kanban", requireAuth, async (req, res, next) => {
  try {
    const rows = await Task.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]);
    res.json({ counts: Object.fromEntries(rows.map((r) => [r._id || "unknown", r.count])) });
  } catch (err) {
    next(err);
  }
});

/** Per-assignee workload: active task count + estimated hours vs. capacity. */
router.get("/workload", requireAuth, async (req, res, next) => {
  try {
    const [rows, capacities] = await Promise.all([
      Task.aggregate([
        { $match: { status: { $in: ACTIVE } } },
        { $unwind: { path: "$assignees", preserveNullAndEmptyArrays: false } },
        {
          $group: {
            _id: "$assignees",
            active: { $sum: 1 },
            highPriority: { $sum: { $cond: [{ $in: ["$priority", ["high", "critical"]] }, 1, 0] } },
            overdue: {
              $sum: { $cond: [{ $and: [{ $ne: ["$dueDate", null] }, { $lt: ["$dueDate", new Date()] }] }, 1, 0] },
            },
          },
        },
        { $sort: { active: -1 } },
        { $limit: 200 },
      ]),
      EmployeeCapacity.find().lean(),
    ]);

    const capByName = new Map(capacities.map((c) => [String(c.employeeName || "").toLowerCase(), c]));
    const items = rows.map((r) => {
      const cap = capByName.get(String(r._id || "").toLowerCase());
      const perTask = cap?.defaultTaskHours || 4;
      const estimatedHours = r.active * perTask;
      const weeklyHours = cap?.weeklyHours || null;
      return {
        assignee: r._id,
        active: r.active,
        highPriority: r.highPriority,
        overdue: r.overdue,
        estimatedHours,
        weeklyHours,
        utilizationPct: weeklyHours ? Math.round((estimatedHours / weeklyHours) * 100) : null,
      };
    });
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
