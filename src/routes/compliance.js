const express = require("express");
const { z } = require("zod");

const ComplianceFlag = require("../models/ComplianceFlag");
const StateLaborRule = require("../models/StateLaborRule");
const TimeEditAuditLog = require("../models/TimeEditAuditLog");
const ViolationNotification = require("../models/ViolationNotification");
const OvertimeTracker = require("../models/OvertimeTracker");

const { requireAuth } = require("../middleware/auth");

const router = express.Router();

function withId(doc) {
  if (!doc) return doc;
  return { ...doc, id: String(doc._id) };
}

router.get("/flags", requireAuth, async (req, res, next) => {
  try {
    const status = String(req.query.status || "open");
    const employee = String(req.query.employee || "").trim();

    const q = {};
    if (status === "open" || status === "resolved") q.status = status;
    if (employee) q.employee = employee;

    const items = await ComplianceFlag.find(q).sort({ detectedAt: -1 }).lean();
    res.json({ items: items.map(withId) });
  } catch (err) {
    next(err);
  }
});

router.post("/flags/:id/resolve", requireAuth, async (req, res, next) => {
  try {
    const id = String(req.params.id || "");
    const updated = await ComplianceFlag.findByIdAndUpdate(
      id,
      {
        status: "resolved",
        resolvedAt: new Date(),
        resolvedByUserId: String(req.user?.sub || ""),
      },
      { new: true }
    ).lean();

    if (!updated) return res.status(404).json({ error: { message: "Flag not found" } });
    res.json({ item: withId(updated) });
  } catch (err) {
    next(err);
  }
});

router.get("/overtime", requireAuth, async (req, res, next) => {
  try {
    const employee = String(req.query.employee || "").trim();
    const q = employee ? { employee } : {};
    const items = await OvertimeTracker.find(q).sort({ weekStart: -1 }).lean();
    res.json({ items: items.map(withId) });
  } catch (err) {
    next(err);
  }
});

router.get("/audit-logs", requireAuth, async (req, res, next) => {
  try {
    const timeEntryId = String(req.query.timeEntryId || "").trim();
    const q = timeEntryId ? { timeEntryId } : {};
    const items = await TimeEditAuditLog.find(q).sort({ createdAt: -1 }).limit(500).lean();
    res.json({ items: items.map(withId) });
  } catch (err) {
    next(err);
  }
});

router.get("/notifications", requireAuth, async (req, res, next) => {
  try {
    const employee = String(req.query.employee || "").trim();
    const q = employee ? { employee } : {};
    const items = await ViolationNotification.find(q).sort({ createdAt: -1 }).limit(500).lean();
    res.json({ items: items.map(withId) });
  } catch (err) {
    next(err);
  }
});

router.get("/state-rules", requireAuth, async (_req, res, next) => {
  try {
    const items = await StateLaborRule.find().sort({ stateCode: 1 }).lean();
    res.json({ items: items.map(withId) });
  } catch (err) {
    next(err);
  }
});

router.put("/state-rules/:stateCode", requireAuth, async (req, res, next) => {
  try {
    const stateCode = String(req.params.stateCode || "").trim().toUpperCase();
    const schema = z.object({
      weeklyOvertimeThresholdHours: z.number().optional(),
      overtimeMultiplier: z.number().optional(),
      mealBreakRequiredAfterHours: z.number().optional(),
      mealBreakMinMinutes: z.number().optional(),
      mealBreakWarningAtHours: z.number().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { message: "Invalid payload" } });

    const updated = await StateLaborRule.findOneAndUpdate(
      { stateCode },
      { stateCode, ...parsed.data },
      { upsert: true, new: true }
    ).lean();

    res.json({ item: withId(updated) });
  } catch (err) {
    next(err);
  }
});

router.get("/export.csv", requireAuth, async (_req, res, next) => {
  try {
    const openFlags = await ComplianceFlag.find({ status: "open" }).sort({ detectedAt: -1 }).lean();

    const rows = [
      ["id", "employee", "type", "severity", "status", "message", "detectedAt"],
      ...openFlags.map((f) => [
        String(f._id),
        String(f.employee || ""),
        String(f.type || ""),
        String(f.severity || ""),
        String(f.status || ""),
        String((f.message || "").replace(/\r?\n/g, " ")),
        f.detectedAt ? new Date(f.detectedAt).toISOString() : "",
      ]),
    ];

    const csv = rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="compliance_report.csv"');
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

router.post("/payroll/export", requireAuth, async (_req, res, next) => {
  try {
    const openCount = await ComplianceFlag.countDocuments({ status: "open", severity: "violation" });
    if (openCount > 0) {
      return res.status(400).json({ error: { message: "Payroll export blocked: unresolved compliance violations exist" } });
    }
    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
