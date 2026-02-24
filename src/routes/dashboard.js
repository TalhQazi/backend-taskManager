const express = require("express");

const Task = require("../models/Task");
const Employee = require("../models/Employee");
const TimeEntry = require("../models/TimeEntry");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

function getDayRange(d = new Date()) {
  const start = new Date(d);
  start.setHours(0, 0, 0, 0);
  const end = new Date(d);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

router.get("/summary", requireAuth, async (_req, res, next) => {
  try {
    const now = new Date();
    const { start, end } = getDayRange(now);

    const [tasks, employeeTotal, entriesToday] = await Promise.all([
      Task.find().lean(),
      Employee.countDocuments(),
      TimeEntry.find({ date: { $gte: start, $lte: end } }).lean(),
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
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
