const express = require("express");

const Task = require("../models/Task");
const TimeEntry = require("../models/TimeEntry");
const { requireAuth, requireSuperAdmin, requireAdmin, requireManager } = require("../middleware/auth");

const router = express.Router();

router.get("/tasks", requireAuth, async (_req, res, next) => {
  try {
    const items = await Task.find().sort({ createdAt: -1 }).lean();
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

router.get("/attendance", requireAuth, async (_req, res, next) => {
  try {
    const items = await TimeEntry.find().sort({ createdAt: -1 }).lean();
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

router.get("/analytics", requireAuth, async (_req, res, next) => {
  try {
    const tasks = await Task.find().lean();
    const entries = await TimeEntry.find().lean();

    const statusCounts = tasks.reduce(
      (acc, t) => {
        acc[t.status] = (acc[t.status] || 0) + 1;
        return acc;
      },
      {}
    );

    const priorityCounts = tasks.reduce(
      (acc, t) => {
        acc[t.priority] = (acc[t.priority] || 0) + 1;
        return acc;
      },
      {}
    );

    const hoursByEmployeeMap = entries.reduce((acc, e) => {
      const k = e.employee || "Unknown";
      acc[k] = (acc[k] || 0) + (Number(e.totalHours) || 0);
      return acc;
    }, {});

    const statusAnalytics = Object.keys(statusCounts).map((status) => ({
      status,
      value: statusCounts[status],
    }));

    const priorityAnalytics = Object.keys(priorityCounts).map((priority) => ({
      priority,
      value: priorityCounts[priority],
    }));

    const hoursByEmployee = Object.keys(hoursByEmployeeMap).map((employee) => ({
      employee,
      hours: Number(hoursByEmployeeMap[employee].toFixed(1)),
    }));

    const weeklyTrend = [];

    res.json({ statusAnalytics, priorityAnalytics, hoursByEmployee, weeklyTrend });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
