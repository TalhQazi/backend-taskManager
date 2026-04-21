const express = require("express");

const Task = require("../models/Task");
const Employee = require("../models/Employee");
const TimeEntry = require("../models/TimeEntry");
const Vehicle = require("../models/Vehicle");
const Patent = require("../models/Patent");
const Website = require("../models/Website");
const Project = require("../models/Project");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

function getDayRange(d = new Date()) {
  const start = new Date(d);
  start.setHours(0, 0, 0, 0);
  const end = new Date(d);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

function buildAssigneeFilter(req) {
  const role = req.user?.role || "";
  const mine = req.query.mine === "true";

  // Admins and managers see all tasks unless they request their own
  if ((role === "admin" || role === "super-admin" || role === "manager") && !mine) {
    return {};
  }

  const userId = String(req.user?.id || req.user?._id || "");
  const username = String(req.user?.username || req.user?.name || "");
  const matchers = [...new Set([userId, username].filter(Boolean))];
  if (matchers.length === 0) return {};
  return { assignees: { $in: matchers } };
}

function sortByPriorityTime(tasks) {
  return tasks.slice().sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority] ?? 1;
    const pb = PRIORITY_ORDER[b.priority] ?? 1;
    if (pa !== pb) return pa - pb;
    const ta = a.dueTime || "99:99";
    const tb = b.dueTime || "99:99";
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });
}

router.get("/summary", requireAuth, async (_req, res, next) => {
  try {
    const now = new Date();
    const { start, end } = getDayRange(now);

    const [
      tasks,
      employeeTotal,
      entriesToday,
      vehicleTotal,
      patentTotal,
      websiteTotal,
      projectTotal,
      openBugReports
    ] = await Promise.all([
      Task.find().lean(),
      Employee.countDocuments(),
      TimeEntry.find({ date: { $gte: start, $lte: end } }).lean(),
      Vehicle.countDocuments(),
      Patent.countDocuments(),
      Website.countDocuments(),
      Project.countDocuments(),
      require("../models/BugReport").countDocuments({ status: "open" })
    ]);

    const isCompletedTask = (t) => String(t?.status || "").toLowerCase() === "completed";
    const isOverdueStatus = (t) => String(t?.status || "").toLowerCase() === "overdue";

    const activeTasks = tasks.filter((t) => !isCompletedTask(t)).length;

    const dueToday = tasks.filter((t) => {
      if (!t?.dueDate) return false;
      const due = new Date(t.dueDate);
      return due >= start && due <= end;
    }).length;

    const overdueTasks = tasks.filter((t) => {
      if (isCompletedTask(t)) return false;
      if (isOverdueStatus(t)) return true;
      if (!t?.dueDate) return false;
      const due = new Date(t.dueDate);
      return due < start;
    }).length;

    const pendingBugs = tasks.filter((t) => 
      t.category === "bug" && !isCompletedTask(t)
    ).length + openBugReports;

    const employeesWorkingSet = new Set(
      entriesToday
        .filter((e) => {
          const status = String(e?.status || "").toLowerCase();
          const clockOut = String(e?.clockOut || "").trim();
          return status === "incomplete" || clockOut === "";
        })
        .map((e) => String(e?.employee || "Unknown"))
    );

    const employeesWorking = employeesWorkingSet.size;

    const hoursLoggedTodayRaw = entriesToday.reduce((acc, e) => acc + (Number(e?.totalHours) || 0), 0);
    const hoursLoggedToday = Number(hoursLoggedTodayRaw.toFixed(1));

    const avgHoursPerEmployee = employeesWorking > 0 ? Number((hoursLoggedToday / employeesWorking).toFixed(1)) : 0;

    res.json({
      activeTasks,
      dueToday,
      overdueTasks,
      employeesWorking,
      employeeTotal,
      hoursLoggedToday,
      avgHoursPerEmployee,
      vehicleTotal,
      patentTotal,
      websiteTotal,
      projectTotal,
      pendingBugs,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/today — Day Ahead view
router.get("/today", requireAuth, async (req, res, next) => {
  try {
    const now = new Date();
    const { start, end } = getDayRange(now);
    const assigneeFilter = buildAssigneeFilter(req);

    const [todayTasks, overdueTasks] = await Promise.all([
      Task.find({ ...assigneeFilter, dueDate: { $gte: start, $lte: end } })
        .select("title priority status dueDate dueTime assignees")
        .lean(),
      Task.find({
        ...assigneeFilter,
        status: { $ne: "completed" },
        $or: [{ status: "overdue" }, { dueDate: { $lt: start } }],
      })
        .select("title priority status dueDate dueTime assignees")
        .lean(),
    ]);

    // Deduplicate: a task overdue today stays in today list only
    const todayIds = new Set(todayTasks.map((t) => String(t._id)));
    const filteredOverdue = overdueTasks.filter((t) => !todayIds.has(String(t._id)));

    const completedToday = todayTasks.filter((t) => t.status === "completed").length;
    const totalToday = todayTasks.length;

    res.json({
      todayTasks: sortByPriorityTime(todayTasks),
      overdueTasks: sortByPriorityTime(filteredOverdue),
      stats: {
        totalToday,
        overdueCount: filteredOverdue.length,
        completedToday,
        completionPercent: totalToday > 0 ? Math.round((completedToday / totalToday) * 100) : 0,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/week — 7-Day Ahead view
router.get("/week", requireAuth, async (req, res, next) => {
  try {
    const now = new Date();
    const { start: todayStart } = getDayRange(now);

    const weekEnd = new Date(todayStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    const assigneeFilter = buildAssigneeFilter(req);

    const tasks = await Task.find({
      ...assigneeFilter,
      dueDate: { $gte: todayStart, $lte: weekEnd },
    })
      .select("title priority status dueDate dueTime assignees")
      .lean();

    const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const DAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

    const days = Array.from({ length: 7 }, (_, i) => {
      const dayStart = new Date(todayStart);
      dayStart.setDate(dayStart.getDate() + i);
      const { end: dayEnd } = getDayRange(dayStart);

      const dayTasks = tasks.filter((t) => {
        if (!t.dueDate) return false;
        const due = new Date(t.dueDate);
        return due >= dayStart && due <= dayEnd;
      });

      const highPriorityCount = dayTasks.filter((t) => t.priority === "high").length;
      const total = dayTasks.length;
      const load = total === 0 ? "none" : total <= 2 ? "low" : total <= 5 ? "medium" : "high";

      return {
        date: dayStart.toISOString().split("T")[0],
        label: DAY_SHORT[dayStart.getDay()],
        dayName: DAY_FULL[dayStart.getDay()],
        isToday: i === 0,
        tasks: sortByPriorityTime(dayTasks),
        totalCount: total,
        highPriorityCount,
        load,
      };
    });

    res.json({ days });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
