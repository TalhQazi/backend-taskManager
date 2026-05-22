const express = require("express");
const router = express.Router();
const Employee = require("../models/Employee");
const ActivityLog = require("../models/ActivityLog");
const { requireAuth } = require("../middleware/auth");
const { cacheDel } = require("../lib/cache");

// Helper to log activity
async function logActivity(req, action, resourceType, resourceId, resourceName, description, extraMetadata = {}) {
  try {
    await ActivityLog.create({
      actorUserId: String(req.user?.sub || req.user?.id || "unknown"),
      actorUsername: String(req.user?.username || req.user?.name || "unknown"),
      actorRole: String(req.user?.role || "unknown"),
      action,
      resourceType,
      resourceId: String(resourceId || ""),
      resourceName: String(resourceName || ""),
      description: String(description || ""),
      ipAddress: String(req.ip || req.headers["x-forwarded-for"] || ""),
      userAgent: String(req.headers["user-agent"] || ""),
      metadata: { body: req.body, ...extraMetadata },
    });
  } catch (err) {
    console.error("Failed to log activity:", err);
  }
}

// 1. POST /api/user/status/start-lunch
router.post("/status/start-lunch", requireAuth, async (req, res, next) => {
  try {
    const employee = await Employee.findById(req.user.id);
    if (!employee) {
      return res.status(404).json({ error: { message: "Employee not found" } });
    }

    const now = new Date();

    // Check if lunch was already started today
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);

    const existingLunch = await ActivityLog.findOne({
      $or: [
        { actorUserId: String(req.user.id) },
        { resourceId: String(req.user.id) }
      ],
      action: "start_lunch",
      createdAt: { $gte: startOfToday, $lte: endOfToday }
    });

    if (existingLunch) {
      return res.status(400).json({ error: { message: "You have already taken your lunch break today." } });
    }

    const expectedEnd = new Date(now.getTime() + 30 * 60 * 1000); // 30 minutes

    employee.current_status = "LUNCH";
    employee.lunch_start_time = now;
    employee.lunch_expected_end = expectedEnd;
    employee.break_start_time = null;

    await employee.save();

    // Invalidate employees list cache
    await cacheDel("employees:list");

    // Emit live socket update
    if (global.io) {
      global.io.emit("status-update", {
        userId: String(employee._id),
        current_status: employee.current_status,
        lunch_start_time: employee.lunch_start_time,
        lunch_expected_end: employee.lunch_expected_end,
        break_start_time: employee.break_start_time,
        name: employee.name,
      });
    }

    await logActivity(req, "start_lunch", "employee", employee._id, employee.name, `${employee.name} went on lunch`);

    res.json({ ok: true, employee });
  } catch (err) {
    next(err);
  }
});

// 2. POST /api/user/status/end-lunch
router.post("/status/end-lunch", requireAuth, async (req, res, next) => {
  try {
    const employee = await Employee.findById(req.user.id);
    if (!employee) {
      return res.status(404).json({ error: { message: "Employee not found" } });
    }

    const now = new Date();
    let isLateReturn = false;
    let exceededMinutes = 0;
    const oldExpectedEnd = employee.lunch_expected_end;
    const oldStartTime = employee.lunch_start_time;

    if (oldExpectedEnd && now > oldExpectedEnd) {
      isLateReturn = true;
      const exceededMs = now.getTime() - oldExpectedEnd.getTime();
      exceededMinutes = Math.round(exceededMs / (60 * 1000));
    }

    employee.current_status = "AVAILABLE";
    employee.lunch_start_time = null;
    employee.lunch_expected_end = null;
    employee.break_start_time = null;

    await employee.save();

    // Invalidate employees list cache
    await cacheDel("employees:list");

    // Emit live socket update
    if (global.io) {
      global.io.emit("status-update", {
        userId: String(employee._id),
        current_status: employee.current_status,
        lunch_start_time: null,
        lunch_expected_end: null,
        break_start_time: null,
        name: employee.name,
      });
    }

    await logActivity(req, "end_lunch", "employee", employee._id, employee.name, `${employee.name} returned from lunch`);

    if (isLateReturn) {
      await logActivity(
        req,
        "late_return",
        "employee",
        employee._id,
        employee.name,
        `LATE RETURN: ${employee.name} returned from lunch late by ${exceededMinutes} minute(s)`,
        {
          isLateReturn: true,
          statusType: "LUNCH",
          exceededMinutes,
          lunch_start_time: oldStartTime,
          lunch_expected_end: oldExpectedEnd,
        }
      );
    }

    res.json({ ok: true, employee });
  } catch (err) {
    next(err);
  }
});

// 3. POST /api/user/status/start-break
router.post("/status/start-break", requireAuth, async (req, res, next) => {
  try {
    const employee = await Employee.findById(req.user.id);
    if (!employee) {
      return res.status(404).json({ error: { message: "Employee not found" } });
    }

    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);

    const existingBreak = await ActivityLog.findOne({
      $or: [
        { actorUserId: String(req.user.id) },
        { resourceId: String(req.user.id) }
      ],
      action: "start_break",
      createdAt: { $gte: startOfToday, $lte: endOfToday }
    });

    if (existingBreak) {
      return res.status(400).json({ error: { message: "You have already taken your short break today." } });
    }

    employee.current_status = "BREAK";
    employee.break_start_time = now;
    employee.lunch_start_time = null;
    employee.lunch_expected_end = null;

    await employee.save();

    // Invalidate employees list cache
    await cacheDel("employees:list");

    // Emit live socket update
    if (global.io) {
      global.io.emit("status-update", {
        userId: String(employee._id),
        current_status: employee.current_status,
        lunch_start_time: employee.lunch_start_time,
        lunch_expected_end: employee.lunch_expected_end,
        break_start_time: employee.break_start_time,
        name: employee.name,
      });
    }

    await logActivity(req, "start_break", "employee", employee._id, employee.name, `${employee.name} went on break`);

    res.json({ ok: true, employee });
  } catch (err) {
    next(err);
  }
});

// 4. POST /api/user/status/end-break
router.post("/status/end-break", requireAuth, async (req, res, next) => {
  try {
    const employee = await Employee.findById(req.user.id);
    if (!employee) {
      return res.status(404).json({ error: { message: "Employee not found" } });
    }

    const now = new Date();
    let isLateReturn = false;
    let exceededMinutes = 0;
    const oldStartTime = employee.break_start_time;

    if (oldStartTime) {
      const expectedEnd = new Date(oldStartTime.getTime() + 15 * 60 * 1000); // 15 minutes limit
      if (now > expectedEnd) {
        isLateReturn = true;
        const exceededMs = now.getTime() - expectedEnd.getTime();
        exceededMinutes = Math.round(exceededMs / (60 * 1000));
      }
    }

    employee.current_status = "AVAILABLE";
    employee.lunch_start_time = null;
    employee.lunch_expected_end = null;
    employee.break_start_time = null;

    await employee.save();

    // Invalidate employees list cache
    await cacheDel("employees:list");

    // Emit live socket update
    if (global.io) {
      global.io.emit("status-update", {
        userId: String(employee._id),
        current_status: employee.current_status,
        lunch_start_time: null,
        lunch_expected_end: null,
        break_start_time: null,
        name: employee.name,
      });
    }

    await logActivity(req, "end_break", "employee", employee._id, employee.name, `${employee.name} returned from break`);

    if (isLateReturn) {
      await logActivity(
        req,
        "late_return",
        "employee",
        employee._id,
        employee.name,
        `LATE RETURN: ${employee.name} returned from break late by ${exceededMinutes} minute(s)`,
        {
          isLateReturn: true,
          statusType: "BREAK",
          exceededMinutes,
          break_start_time: oldStartTime,
        }
      );
    }

    res.json({ ok: true, employee });
  } catch (err) {
    next(err);
  }
});

// 5. GET /api/team/statuses (Aggregates and returns current statuses for active employees)
// Placed before the single-user GET route to avoid route conflict
router.get("/statuses", requireAuth, async (req, res, next) => {
  try {
    const employees = await Employee.find({ status: "active" })
      .select("_id name current_status lunch_start_time lunch_expected_end break_start_time")
      .lean();
    res.json({ items: employees });
  } catch (err) {
    next(err);
  }
});

// 6. GET /api/user/:id/status
router.get("/:id/status", requireAuth, async (req, res, next) => {
  try {
    const employee = await Employee.findById(req.params.id)
      .select("current_status lunch_start_time lunch_expected_end break_start_time")
      .lean();
    if (!employee) {
      return res.status(404).json({ error: { message: "Employee not found" } });
    }
    res.json(employee);
  } catch (err) {
    next(err);
  }
});

// 7. GET /api/user/status-history (Aggregates and returns lunch/break history logs and weekly totals)
router.get("/status-history", requireAuth, async (req, res, next) => {
  try {
    const { startDate, endDate, employee } = req.query;

    // Default to last 7 days if no dates provided
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();

    // Ensure they are valid dates
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({ error: { message: "Invalid date parameters" } });
    }

    // Build filter
    const filter = {
      action: { $in: ["start_lunch", "end_lunch", "start_break", "end_break", "late_return"] },
      createdAt: { $gte: start, $lte: end }
    };

    if (employee) {
      filter.$or = [
        { resourceId: employee },
        { resourceName: { $regex: employee, $options: "i" } },
        { actorUserId: employee },
        { actorUsername: { $regex: employee, $options: "i" } }
      ];
    }

    const logs = await ActivityLog.find(filter)
      .sort({ createdAt: 1 })
      .lean();

    // Reconstruct break/lunch sessions
    const employeeSessions = {};
    const sessions = [];

    for (const log of logs) {
      const empId = log.resourceId || log.actorUserId;
      const empName = log.resourceName || log.actorUsername;
      if (!empId || empId === "unknown" || empName === "unknown") continue;

      if (!employeeSessions[empId]) {
        employeeSessions[empId] = {
          lunch: null,
          break: null,
          sessions: []
        };
      }

      const state = employeeSessions[empId];

      if (log.action === "start_lunch") {
        state.lunch = {
          id: String(log._id),
          employeeId: empId,
          employeeName: empName,
          type: "LUNCH",
          startTime: log.createdAt,
          endTime: null,
          durationMinutes: 0,
          isLate: false,
          exceededMinutes: 0
        };
      } else if (log.action === "end_lunch") {
        if (state.lunch) {
          state.lunch.endTime = log.createdAt;
          const diffMs = new Date(log.createdAt).getTime() - new Date(state.lunch.startTime).getTime();
          state.lunch.durationMinutes = Math.max(0, Math.round(diffMs / 60000));
          state.sessions.push(state.lunch);
          state.lunch = null;
        }
      } else if (log.action === "start_break") {
        state.break = {
          id: String(log._id),
          employeeId: empId,
          employeeName: empName,
          type: "BREAK",
          startTime: log.createdAt,
          endTime: null,
          durationMinutes: 0,
          isLate: false,
          exceededMinutes: 0
        };
      } else if (log.action === "end_break") {
        if (state.break) {
          state.break.endTime = log.createdAt;
          const diffMs = new Date(log.createdAt).getTime() - new Date(state.break.startTime).getTime();
          state.break.durationMinutes = Math.max(0, Math.round(diffMs / 60000));
          state.sessions.push(state.break);
          state.break = null;
        }
      } else if (log.action === "late_return") {
        const type = log.metadata?.statusType || "LUNCH";
        const exceeded = log.metadata?.exceededMinutes || 0;

        // Try to update the last completed session of this type
        const list = state.sessions;
        const last = list[list.length - 1];
        if (last && last.type === type) {
          last.isLate = true;
          last.exceededMinutes = exceeded;
        } else if (type === "LUNCH" && state.lunch) {
          state.lunch.isLate = true;
          state.lunch.exceededMinutes = exceeded;
        } else if (type === "BREAK" && state.break) {
          state.break.isLate = true;
          state.break.exceededMinutes = exceeded;
        }
      }
    }

    // Collect all sessions, including unresolved ones
    for (const empId in employeeSessions) {
      const state = employeeSessions[empId];
      if (state.lunch) {
        state.sessions.push(state.lunch);
      }
      if (state.break) {
        state.sessions.push(state.break);
      }
      sessions.push(...state.sessions);
    }

    // Sort sessions descending by start time
    sessions.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

    // Calculate aggregate weekly/period stats grouped by employee
    const statsMap = {};

    for (const s of sessions) {
      const empId = s.employeeId;
      const empName = s.employeeName;

      if (!statsMap[empId]) {
        statsMap[empId] = {
          employeeId: empId,
          employeeName: empName,
          totalLunchMinutes: 0,
          totalBreakMinutes: 0,
          lunchSessionsCount: 0,
          breakSessionsCount: 0,
          lateReturnsCount: 0,
          totalExceededMinutes: 0
        };
      }

      const stats = statsMap[empId];
      const duration = s.durationMinutes || 0;

      if (s.type === "LUNCH") {
        stats.totalLunchMinutes += duration;
        if (s.endTime) {
          stats.lunchSessionsCount += 1;
        }
      } else if (s.type === "BREAK") {
        stats.totalBreakMinutes += duration;
        if (s.endTime) {
          stats.breakSessionsCount += 1;
        }
      }

      if (s.isLate) {
        stats.lateReturnsCount += 1;
        stats.totalExceededMinutes += (s.exceededMinutes || 0);
      }
    }

    const weeklyStats = Object.values(statsMap);

    res.json({
      ok: true,
      sessions,
      weeklyStats
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
