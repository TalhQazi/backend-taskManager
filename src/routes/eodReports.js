const express = require("express");

const EODReport = require("../models/EODReport");
const TimeEntry = require("../models/TimeEntry");
const Employee = require("../models/Employee");
const Settings = require("../models/Settings");
const { requireAuth, requireRole } = require("../middleware/auth");
const { cacheWrap, cacheDel } = require("../lib/cache");

const router = express.Router();

function withId(doc) {
  if (!doc) return doc;
  return { ...doc, id: String(doc._id) };
}

// Helper function to get day range
function getDayRange(date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

// ==================== MANAGER ENDPOINTS ====================

// GET /api/manager/eod-status - Get EOD status for all employees
router.get("/eod-status", requireAuth, requireRole(["manager", "admin", "super-admin"]), async (req, res, next) => {
  try {
    const { date } = req.query;
    const targetDate = date ? new Date(date) : new Date();
    const { start, end } = getDayRange(targetDate);

    // Get all active employees (same fields as Employee Directory)
    const employees = await Employee.find(
      { status: "active" },
      { name: 1, email: 1, _id: 1 }
    ).lean();

    // Get all time entries for the target date
    const timeEntries = await TimeEntry.find({
      date: { $gte: start, $lte: end },
    }).lean();

    // Get all EOD reports for the target date
    const eodReports = await EODReport.find({
      date: { $gte: start, $lte: end },
    }).lean();

    // Bulk-fetch avatars from Settings keyed by Employee._id (same as Employee Directory)
    const empIds = employees.map((e) => String(e._id));
    const settingsList = empIds.length
      ? await Settings.find({ userId: { $in: empIds } })
          .select("userId avatarUrl avatarDataUrl")
          .lean()
      : [];
    const avatarById = new Map(
      settingsList.map((s) => [String(s.userId), String(s.avatarDataUrl || s.avatarUrl || "").trim()])
    );

    // Create a map for quick lookup
    const timeEntryByEmployee = new Map();
    timeEntries.forEach((entry) => {
      timeEntryByEmployee.set(entry.employee, entry);
    });

    const eodReportByUserId = new Map();
    eodReports.forEach((report) => {
      eodReportByUserId.set(String(report.userId), report);
    });

    // Build status list
    const statusList = await Promise.all(
      employees.map(async (emp) => {
        const timeEntry = timeEntryByEmployee.get(emp.name);
        const userId = await getUserIdByEmployeeEmail(emp.email);
        const avatar = avatarById.get(String(emp._id)) || "";

        if (!timeEntry) {
          return {
            employeeId: String(emp._id),
            employeeName: emp.name,
            avatar,
            status: "not_clocked_in",
            clockIn: undefined,
            clockOut: undefined,
            clockInAt: undefined,
            clockOutAt: undefined,
            reportSubmittedAt: undefined,
          };
        }

        const eodReport = userId ? eodReportByUserId.get(userId) : null;

        if (!eodReport) {
          const clockOutTime = timeEntry.clockOutAt || timeEntry.clockOut;
          if (clockOutTime) {
            return {
              employeeId: String(emp._id),
              employeeName: emp.name,
              avatar,
              status: "missing",
              clockIn: timeEntry.clockIn || formatTime(timeEntry.clockInAt),
              clockOut: timeEntry.clockOut || formatTime(timeEntry.clockOutAt),
              clockInAt: timeEntry.clockInAt || null,
              clockOutAt: timeEntry.clockOutAt || null,
              reportSubmittedAt: undefined,
            };
          }
          return {
            employeeId: String(emp._id),
            employeeName: emp.name,
            avatar,
            status: "not_clocked_in",
            clockIn: timeEntry.clockIn || formatTime(timeEntry.clockInAt),
            clockOut: undefined,
            clockInAt: timeEntry.clockInAt || null,
            clockOutAt: undefined,
            reportSubmittedAt: undefined,
          };
        }

        const clockOutTime = timeEntry.clockOutAt || timeEntry.clockOut;
        const reportTime = eodReport.updatedAt || eodReport.createdAt;
        let status = "submitted";

        if (clockOutTime && reportTime) {
          const clockOutDate = new Date(clockOutTime);
          const reportDate = new Date(reportTime);
          const diffMinutes = (reportDate.getTime() - clockOutDate.getTime()) / (1000 * 60);
          if (diffMinutes > 30) {
            status = "late";
          }
        }

        return {
          employeeId: String(emp._id),
          employeeName: emp.name,
          avatar,
          status,
          clockIn: timeEntry.clockIn || formatTime(timeEntry.clockInAt),
          clockOut: timeEntry.clockOut || formatTime(timeEntry.clockOutAt),
          clockInAt: timeEntry.clockInAt || null,
          clockOutAt: timeEntry.clockOutAt || null,
          reportSubmittedAt: eodReport.updatedAt || eodReport.createdAt,
        };
      })
    );

    return res.json({ items: statusList });
  } catch (err) {
    next(err);
  }
});

// GET /api/manager/eod-reports - Get EOD reports with filters
router.get("/eod-reports", requireAuth, requireRole(["manager", "admin", "super-admin"]), async (req, res, next) => {
  try {
    const { date, from, to, location, employeeId, employee, status, page = 1, limit = 50 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const matchStage = {};

    // Date/Range filter
    if (from) {
      const start = new Date(from);
      start.setHours(0, 0, 0, 0);
      const end = to ? new Date(to) : new Date();
      end.setHours(23, 59, 59, 999);
      matchStage.date = { $gte: start, $lte: end };
    } else if (date) {
      const { start, end } = getDayRange(new Date(date));
      matchStage.date = { $gte: start, $lte: end };
    }

    // Location filter
    if (location && location !== "all") {
      const employeesInLocation = await Employee.find({ location }).select("_id").lean();
      const empIds = employeesInLocation.map(e => e._id);
      matchStage.employeeId = { $in: empIds };
    }

    // Employee filter - support both employeeId and employee (name) parameters
    if (employeeId) {
      matchStage.employeeId = employeeId;
    } else if (employee) {
      // Filter by employee name (case-insensitive)
      matchStage.employeeName = new RegExp(`^${employee.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
    }

    // Status filter
    if (status && status !== "all") {
      matchStage.status = status;
    }

    const cacheKey = `eod-reports:list:${date || 'all'}:${from || 'none'}:${to || 'none'}:${location || 'all'}:${employeeId || employee || 'all'}:${status || 'all'}:p${page}:l${limit}`;

    const result = await cacheWrap(cacheKey, async () => {
      const [reports, total] = await Promise.all([
        EODReport.find(matchStage)
          .sort({ date: -1 })
          .skip(skip)
          .limit(Number(limit))
          .lean(),
        EODReport.countDocuments(matchStage),
      ]);

      // Get time entries for additional data
      const timeEntryIds = reports.map((r) => r.timeEntryId).filter(Boolean);
      const orConditions = [];
      if (timeEntryIds.length > 0) {
        orConditions.push({ _id: { $in: timeEntryIds } });
      }
      reports.forEach((report) => {
        if (report.employeeName && report.date) {
          const { start, end } = getDayRange(report.date);
          orConditions.push({
            employee: report.employeeName,
            date: { $gte: start, $lte: end }
          });
        }
      });

      const timeEntries = orConditions.length > 0
        ? await TimeEntry.find({ $or: orConditions }).lean()
        : [];

      const timeEntryById = new Map(
        timeEntries.map((te) => [String(te._id), te])
      );

      const timeEntryByEmployeeAndDate = new Map();
      timeEntries.forEach((te) => {
        if (te.employee && te.date) {
          const dateKey = new Date(te.date).toISOString().slice(0, 10);
          const key = `${te.employee.toLowerCase()}_${dateKey}`;
          timeEntryByEmployeeAndDate.set(key, te);
        }
      });

      // Fetch employee locations
      const reportEmployeeIds = reports.map(r => r.employeeId).filter(Boolean);
      const employeesList = await Employee.find({ _id: { $in: reportEmployeeIds } }).select("_id location").lean();
      const employeeLocationMap = new Map(
        employeesList.map(e => [String(e._id), e.location || ""])
      );

      const items = reports.map((report) => {
        let timeEntry = report.timeEntryId ? timeEntryById.get(String(report.timeEntryId)) : null;
        if (!timeEntry && report.employeeName && report.date) {
          const dateKey = new Date(report.date).toISOString().slice(0, 10);
          const key = `${report.employeeName.toLowerCase()}_${dateKey}`;
          timeEntry = timeEntryByEmployeeAndDate.get(key);
        }
        return {
          id: String(report._id),
          userId: report.userId,
          employeeName: report.employeeName,
          date: report.date,
          rawInput: report.rawInput,
          inputType: report.inputType,
          status: report.status,
          createdAt: report.updatedAt || report.createdAt,
          clockIn: timeEntry?.clockIn || formatTime(timeEntry?.clockInAt),
          clockOut: timeEntry?.clockOut || formatTime(timeEntry?.clockOutAt),
          clockInAt: timeEntry?.clockInAt || null,
          clockOutAt: timeEntry?.clockOutAt || null,
          totalHours: timeEntry?.totalHours,
          aiSummary: report.aiSummary || "",
          productivityScore: report.productivityScore,
          flags: report.flags || [],
          employeeLocation: employeeLocationMap.get(String(report.employeeId)) || "",
        };
      });

      return { items, total, page: Number(page), limit: Number(limit) };
    }, 30);

    return res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/manager/eod-reports/:id - Get single EOD report by ID
router.get("/eod-reports/:id", requireAuth, requireRole(["manager", "admin", "super-admin"]), async (req, res, next) => {
  try {
    const { id } = req.params;
    const report = await EODReport.findById(id).lean();
    if (!report) {
      return res.status(404).json({ error: "EOD report not found" });
    }

    let timeEntry = report.timeEntryId
      ? await TimeEntry.findById(report.timeEntryId).lean()
      : null;

    if (!timeEntry && report.employeeName && report.date) {
      const { start, end } = getDayRange(report.date);
      timeEntry = await TimeEntry.findOne({
        employee: report.employeeName,
        date: { $gte: start, $lte: end }
      }).lean();
    }

    const item = {
      id: String(report._id),
      userId: report.userId,
      employeeName: report.employeeName,
      date: report.date,
      rawInput: report.rawInput,
      inputType: report.inputType,
      status: report.status,
      createdAt: report.updatedAt || report.createdAt,
      clockIn: timeEntry?.clockIn || formatTime(timeEntry?.clockInAt),
      clockOut: timeEntry?.clockOut || formatTime(timeEntry?.clockOutAt),
      clockInAt: timeEntry?.clockInAt || null,
      clockOutAt: timeEntry?.clockOutAt || null,
      totalHours: timeEntry?.totalHours,
      aiSummary: report.aiSummary || "",
      productivityScore: report.productivityScore,
      flags: report.flags || [],
    };

    res.json({ item });
  } catch (err) {
    next(err);
  }
});

// GET /api/manager/time-entries - Get all employees' time entries for a date range
router.get("/time-entries", requireAuth, requireRole(["manager", "admin", "super-admin"]), async (req, res, next) => {
  try {
    const { date, employeeId, page = 1, limit = 50 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    let dateFilter = {};
    if (date) {
      const targetDate = new Date(date);
      const start = new Date(targetDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(targetDate);
      end.setHours(23, 59, 59, 999);
      dateFilter = { date: { $gte: start, $lte: end } };
    } else {
      const today = new Date();
      const start = new Date(today);
      start.setHours(0, 0, 0, 0);
      const end = new Date(today);
      end.setHours(23, 59, 59, 999);
      dateFilter = { date: { $gte: start, $lte: end } };
    }

    const filter = dateFilter;
    if (employeeId) {
      filter.employee = employeeId;
    }

    const [entries, total] = await Promise.all([
      TimeEntry.find(filter)
        .sort({ date: -1, clockInAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      TimeEntry.countDocuments(filter),
    ]);

    const items = entries.map((entry) => ({
      id: String(entry._id),
      userId: entry.userId,
      employee: entry.employee,
      avatar: entry.avatar,
      date: entry.date,
      clockIn: entry.clockIn,
      clockOut: entry.clockOut,
      clockInAt: entry.clockInAt,
      clockOutAt: entry.clockOutAt,
      breakTime: entry.breakTime,
      totalHours: entry.totalHours,
      status: entry.status,
      location: entry.location,
    }));

    res.json({ items, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    next(err);
  }
});

// Helper functions
async function getUserIdByEmployeeEmail(email) {
  try {
    const emp = await Employee.findOne(
      { email: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
      { _id: 1 }
    ).lean();
    return emp ? String(emp._id) : null;
  } catch {
    return null;
  }
}

function formatTime(date) {
  if (!date) return undefined;
  const d = new Date(date);
  if (!Number.isFinite(d.getTime())) return undefined;
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
}

module.exports = router;
