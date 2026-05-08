const express = require("express");

const EODReport = require("../models/EODReport");
const TimeEntry = require("../models/TimeEntry");
const Employee = require("../models/Employee");
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

    // Get all active employees
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
        
        if (!timeEntry) {
          return {
            employeeId: String(emp._id),
            employeeName: emp.name,
            status: "not_clocked_in",
            clockIn: undefined,
            clockOut: undefined,
            reportSubmittedAt: undefined,
          };
        }

        const eodReport = userId ? eodReportByUserId.get(userId) : null;
        
        if (!eodReport) {
          // Employee clocked in/out but no EOD report
          const clockOutTime = timeEntry.clockOutAt || timeEntry.clockOut;
          if (clockOutTime) {
            return {
              employeeId: String(emp._id),
              employeeName: emp.name,
              status: "missing",
              clockIn: timeEntry.clockIn || formatTime(timeEntry.clockInAt),
              clockOut: timeEntry.clockOut || formatTime(timeEntry.clockOutAt),
              reportSubmittedAt: undefined,
            };
          }
          // Still clocked in
          return {
            employeeId: String(emp._id),
            employeeName: emp.name,
            status: "not_clocked_in",
            clockIn: timeEntry.clockIn || formatTime(timeEntry.clockInAt),
            clockOut: undefined,
            reportSubmittedAt: undefined,
          };
        }

        // Check if report was submitted late (after clock out)
        const clockOutTime = timeEntry.clockOutAt || timeEntry.clockOut;
        const reportTime = eodReport.createdAt;
        let status = "submitted";
        
        if (clockOutTime && reportTime) {
          const clockOutDate = new Date(clockOutTime);
          const reportDate = new Date(reportTime);
          const diffMinutes = (reportDate.getTime() - clockOutDate.getTime()) / (1000 * 60);
          
          // Consider late if submitted more than 30 minutes after clock out
          if (diffMinutes > 30) {
            status = "late";
          }
        }

        return {
          employeeId: String(emp._id),
          employeeName: emp.name,
          status,
          clockIn: timeEntry.clockIn || formatTime(timeEntry.clockInAt),
          clockOut: timeEntry.clockOut || formatTime(timeEntry.clockOutAt),
          reportSubmittedAt: eodReport.createdAt,
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
    const { date, employeeId, status, page = 1, limit = 50 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const matchStage = {};

    // Date filter
    if (date) {
      const { start, end } = getDayRange(new Date(date));
      matchStage.date = { $gte: start, $lte: end };
    }

    // Employee filter
    if (employeeId) {
      matchStage.employeeId = employeeId;
    }

    // Status filter
    if (status && status !== "all") {
      matchStage.status = status;
    }

    const cacheKey = `eod-reports:list:${date || 'all'}:${employeeId || 'all'}:${status || 'all'}:p${page}:l${limit}`;
    
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
      const reportIds = reports.map((r) => String(r._id));
      const timeEntries = await TimeEntry.find({
        _id: { $in: reports.map((r) => r.timeEntryId).filter(Boolean) },
      }).lean();

      const timeEntryById = new Map(
        timeEntries.map((te) => [String(te._id), te])
      );

      const items = reports.map((report) => {
        const timeEntry = report.timeEntryId ? timeEntryById.get(String(report.timeEntryId)) : null;
        return {
          id: String(report._id),
          userId: report.userId,
          employeeName: report.employeeName,
          date: report.date,
          rawInput: report.rawInput,
          inputType: report.inputType,
          status: report.status,
          createdAt: report.createdAt,
          clockIn: timeEntry?.clockIn || formatTime(timeEntry?.clockInAt),
          clockOut: timeEntry?.clockOut || formatTime(timeEntry?.clockOutAt),
          totalHours: timeEntry?.totalHours,
        };
      });

      return { items, total, page: Number(page), limit: Number(limit) };
    }, 30);

    return res.json(result);
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
