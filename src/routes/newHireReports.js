const express = require("express");
const NewHireReport = require("../models/NewHireReport");
const NewHireSubmissionLog = require("../models/NewHireSubmissionLog");
const { requireAuth, requireRole } = require("../middleware/auth");
const { generateMaineNewHireData, submitViaSFTP, submitViaWebForm } = require("../utils/newHireSubmissionEngine");
const { createNotification } = require("../utils/notifications");

const router = express.Router();

// GET /api/new-hire-reports/all - Get all new hire reporting entries (Admin & Manager)
router.get("/all", requireAuth, requireRole(["super-admin", "admin", "manager"]), async (req, res, next) => {
  try {
    const { status } = req.query;
    const filter = {};
    if (status && ["pending", "submitted", "failed", "overridden"].includes(status)) {
      filter.status = status;
    }

    const reports = await NewHireReport.find(filter)
      .populate("overrideBy", "name email")
      .sort({ countdownExpiry: 1 })
      .lean();

    const items = reports.map(r => ({
      id: String(r._id),
      employeeId: String(r.employeeId),
      onboardingId: String(r.onboardingId),
      employeeName: r.employeeName,
      employeeAddress: r.employeeAddress,
      hireDate: r.hireDate,
      employerName: r.employerName,
      employerAddress: r.employerAddress,
      employerFEIN: r.employerFEIN,
      status: r.status,
      attemptsCount: r.attemptsCount,
      confirmationId: r.confirmationId,
      countdownExpiry: r.countdownExpiry,
      lastAttemptAt: r.lastAttemptAt,
      errorMessage: r.errorMessage,
      overrideReason: r.overrideReason,
      overrideBy: r.overrideBy,
      overrideAt: r.overrideAt,
      createdAt: r.createdAt
    }));

    return res.json({ items });
  } catch (err) {
    next(err);
  }
});

// GET /api/new-hire-reports/stats - Get KPI dashboard statistics
router.get("/stats", requireAuth, requireRole(["super-admin", "admin", "manager"]), async (req, res, next) => {
  try {
    const [total, pending, submitted, failed, overridden] = await Promise.all([
      NewHireReport.countDocuments(),
      NewHireReport.countDocuments({ status: "pending" }),
      NewHireReport.countDocuments({ status: "submitted" }),
      NewHireReport.countDocuments({ status: "failed" }),
      NewHireReport.countDocuments({ status: "overridden" })
    ]);

    return res.json({
      item: {
        total,
        pending,
        submitted,
        failed,
        overridden,
        complianceRate: total > 0 ? Math.round(((submitted + overridden) / total) * 100) : 100
      }
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/new-hire-reports/:id/logs - Get submission logs for a specific report
router.get("/:id/logs", requireAuth, requireRole(["super-admin", "admin", "manager"]), async (req, res, next) => {
  try {
    const logs = await NewHireSubmissionLog.find({ reportId: req.params.id })
      .sort({ createdAt: -1 })
      .lean();

    const items = logs.map(l => ({
      id: String(l._id),
      attemptNumber: l.attemptNumber,
      status: l.status,
      method: l.method,
      payloadPreview: l.payloadPreview,
      errorMessage: l.errorMessage,
      confirmationId: l.confirmationId,
      createdAt: l.createdAt
    }));

    return res.json({ items });
  } catch (err) {
    next(err);
  }
});

// POST /api/new-hire-reports/:id/resubmit - Manually trigger filing resubmission
router.post("/:id/resubmit", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const report = await NewHireReport.findById(req.params.id);
    if (!report) {
      return res.status(404).json({ error: { message: "Reporting entry not found" } });
    }

    report.attemptsCount += 1;
    report.lastAttemptAt = new Date();

    console.log(`[Manual Filing] Direct submission trigger for employee '${report.employeeName}' (Attempt #${report.attemptsCount})...`);

    let result = null;
    let submissionErr = null;

    try {
      const data = generateMaineNewHireData(report);
      if (process.env.MAINE_SFTP_HOST) {
        result = await submitViaSFTP(report, data);
      } else {
        result = await submitViaWebForm(report);
      }
    } catch (e) {
      submissionErr = e.message;
    }

    if (result && result.success) {
      report.status = "submitted";
      report.confirmationId = result.confirmationId;
      report.errorMessage = "";
      await report.save();

      await NewHireSubmissionLog.create({
        reportId: report._id,
        attemptNumber: report.attemptsCount,
        status: "submitted",
        method: result.method,
        payloadPreview: `Employer FEIN: ${report.employerFEIN} | Employee: ${report.employeeName}`,
        confirmationId: result.confirmationId
      });

      return res.json({
        success: true,
        message: `Filing submitted successfully via ${result.method}!`,
        item: {
          status: report.status,
          confirmationId: report.confirmationId,
          attemptsCount: report.attemptsCount
        }
      });
    } else {
      const errText = submissionErr || "Connection error during automated filing attempt.";
      report.errorMessage = errText;
      
      if (report.attemptsCount >= 3) {
        report.status = "failed";
      }
      await report.save();

      await NewHireSubmissionLog.create({
        reportId: report._id,
        attemptNumber: report.attemptsCount,
        status: "failed",
        method: process.env.MAINE_SFTP_HOST ? "sftp" : "webform",
        payloadPreview: `Employer FEIN: ${report.employerFEIN} | Employee: ${report.employeeName}`,
        errorMessage: errText
      });

      return res.status(500).json({
        error: {
          message: `Submission failed: ${errText}`,
          attemptsCount: report.attemptsCount,
          status: report.status
        }
      });
    }
  } catch (err) {
    next(err);
  }
});

// POST /api/new-hire-reports/:id/override - Manual override: mark as filed with custom reasoning
router.post("/:id/override", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const { reason } = req.body;
    if (!reason || reason.trim().length < 5) {
      return res.status(400).json({ error: { message: "Manual override requires a detailed reason (at least 5 characters)." } });
    }

    const report = await NewHireReport.findById(req.params.id);
    if (!report) {
      return res.status(404).json({ error: { message: "Reporting entry not found" } });
    }

    report.status = "overridden";
    report.overrideReason = reason;
    report.overrideBy = req.user.id;
    report.overrideAt = new Date();
    report.errorMessage = "";
    await report.save();

    // Log the manual override audit
    await NewHireSubmissionLog.create({
      reportId: report._id,
      attemptNumber: report.attemptsCount,
      status: "submitted",
      method: "webform",
      payloadPreview: `Manual Admin Override by ${req.user.username || "admin"}. Reason: ${reason}`
    });

    return res.json({
      success: true,
      message: "Report marked as overridden.",
      item: {
        status: report.status,
        overrideReason: report.overrideReason,
        overrideAt: report.overrideAt
      }
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
