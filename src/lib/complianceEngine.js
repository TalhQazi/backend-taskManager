const StateLaborRule = require("../models/StateLaborRule");
const ComplianceFlag = require("../models/ComplianceFlag");
const ViolationNotification = require("../models/ViolationNotification");
const OvertimeTracker = require("../models/OvertimeTracker");

function startOfWeekISO(d) {
  const dt = new Date(d);
  dt.setHours(0, 0, 0, 0);
  const day = dt.getDay();
  const diff = (day + 6) % 7;
  dt.setDate(dt.getDate() - diff);
  return dt.toISOString().slice(0, 10);
}

function endOfWeekISO(d) {
  const dt = new Date(d);
  dt.setHours(0, 0, 0, 0);
  const day = dt.getDay();
  const diff = (7 - ((day + 6) % 7) - 1);
  dt.setDate(dt.getDate() + diff);
  return dt.toISOString().slice(0, 10);
}

function minutesBetween(a, b) {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.floor(ms / 60000));
}

function sumMealBreakMinutes(timeEntry) {
  const breaks = Array.isArray(timeEntry.breaks) ? timeEntry.breaks : [];
  return breaks
    .filter((b) => (b?.type || "meal") === "meal" && b?.startAt && b?.endAt)
    .reduce((acc, b) => acc + minutesBetween(b.startAt, b.endAt), 0);
}

async function getRuleForState(stateCode) {
  const code = String(stateCode || "").trim().toUpperCase() || "DEFAULT";
  let rule = await StateLaborRule.findOne({ stateCode: code }).lean();
  if (!rule) {
    rule = await StateLaborRule.findOne({ stateCode: "DEFAULT" }).lean();
  }
  if (!rule) {
    rule = await StateLaborRule.create({ stateCode: "DEFAULT" });
    rule = rule.toObject();
  }
  return rule;
}

async function upsertFlag({ employee, userId, timeEntryId, type, severity, message, metadata, ruleStateCode }) {
  const existing = await ComplianceFlag.findOne({ employee, timeEntryId, type, status: "open" }).lean();
  if (existing) {
    await ComplianceFlag.findByIdAndUpdate(existing._id, {
      severity,
      message,
      metadata,
      ruleStateCode,
      detectedAt: new Date(),
    });
    return String(existing._id);
  }

  const created = await ComplianceFlag.create({
    employee,
    userId: userId || "",
    timeEntryId: timeEntryId || "",
    type,
    severity,
    message,
    metadata,
    ruleStateCode: ruleStateCode || "",
    status: "open",
    detectedAt: new Date(),
  });
  return String(created._id);
}

async function closeFlagsForEntry({ employee, timeEntryId, type }) {
  await ComplianceFlag.updateMany(
    { employee, timeEntryId, type, status: "open" },
    { $set: { status: "resolved", resolvedAt: new Date() } }
  );
}

async function maybeCreateNotification({ employee, userId, timeEntryId, complianceFlagId, type, message }) {
  const exists = await ViolationNotification.findOne({ employee, timeEntryId, type }).lean();
  if (exists) return;
  await ViolationNotification.create({
    employee,
    userId: userId || "",
    timeEntryId: timeEntryId || "",
    complianceFlagId: complianceFlagId || "",
    type,
    message: message || "",
  });
}

async function evaluateMealBreakCompliance({ timeEntry, now = new Date() }) {
  const employee = String(timeEntry.employee || "").trim();
  if (!employee) return { hardStop: false };

  const rule = await getRuleForState(timeEntry.stateCode);

  const clockInAt = timeEntry.clockInAt || null;
  const clockOutAt = timeEntry.clockOutAt || null;
  if (!clockInAt) return { hardStop: false };

  const shiftEnd = clockOutAt || now;
  const shiftMinutes = minutesBetween(clockInAt, shiftEnd);
  const shiftHours = shiftMinutes / 60;

  const mealMinutes = sumMealBreakMinutes(timeEntry);

  if (shiftHours >= Number(rule.mealBreakWarningAtHours || 5.5) && mealMinutes === 0 && !clockOutAt) {
    const id = await upsertFlag({
      employee,
      userId: timeEntry.userId,
      timeEntryId: String(timeEntry._id || ""),
      type: "meal_break",
      severity: "warning",
      message: `Meal break warning: ${rule.mealBreakMinMinutes} min break required for shifts over ${rule.mealBreakRequiredAfterHours} hours.`,
      metadata: { shiftHours, mealMinutes },
      ruleStateCode: rule.stateCode,
    });

    await maybeCreateNotification({
      employee,
      userId: timeEntry.userId,
      timeEntryId: String(timeEntry._id || ""),
      complianceFlagId: id,
      type: "meal_break_warning",
      message: `Warning: Approaching ${rule.mealBreakRequiredAfterHours} hours without a meal break.`,
    });
  }

  if (shiftHours > Number(rule.mealBreakRequiredAfterHours || 6)) {
    if (mealMinutes < Number(rule.mealBreakMinMinutes || 30)) {
      const id = await upsertFlag({
        employee,
        userId: timeEntry.userId,
        timeEntryId: String(timeEntry._id || ""),
        type: "meal_break",
        severity: "violation",
        message: `Meal break violation: Required ${rule.mealBreakMinMinutes} minutes for shifts over ${rule.mealBreakRequiredAfterHours} hours.`,
        metadata: { shiftHours, mealMinutes },
        ruleStateCode: rule.stateCode,
      });

      await maybeCreateNotification({
        employee,
        userId: timeEntry.userId,
        timeEntryId: String(timeEntry._id || ""),
        complianceFlagId: id,
        type: "violation",
        message: `Violation: Meal break not compliant (only ${mealMinutes} minutes).`,
      });

      const hardStop = !!clockOutAt;
      return { hardStop };
    }
  }

  await closeFlagsForEntry({ employee, timeEntryId: String(timeEntry._id || ""), type: "meal_break" });
  return { hardStop: false };
}

async function recomputeWeeklyOvertime({ employee, userId, weekStart, weekEnd, totalHours, hourlyRate, rule }) {
  const threshold = Number(rule.weeklyOvertimeThresholdHours || 40);
  const overtimeMultiplier = Number(rule.overtimeMultiplier || 1.5);

  const overtimeHours = Math.max(0, totalHours - threshold);
  const regularHours = totalHours - overtimeHours;

  const hr = Number(hourlyRate || 0);
  const otRate = hr * overtimeMultiplier;

  await OvertimeTracker.findOneAndUpdate(
    { employee, weekStart },
    {
      employee,
      userId: userId || "",
      weekStart,
      weekEnd,
      totalHours,
      regularHours,
      overtimeHours,
      hourlyRate: hr,
      overtimeRate: otRate,
    },
    { upsert: true, new: true }
  );

  if (overtimeHours > 0) {
    await upsertFlag({
      employee,
      userId,
      timeEntryId: "",
      type: "overtime",
      severity: "violation",
      message: `Overtime: ${overtimeHours.toFixed(2)} hours over ${threshold} this week.`,
      metadata: { weekStart, weekEnd, totalHours, regularHours, overtimeHours },
      ruleStateCode: rule.stateCode,
    });
  }
}

async function evaluateOvertimeCompliance({ employee, userId, timeEntries, hourlyRate, stateCode, refDate }) {
  if (!employee) return;
  const rule = await getRuleForState(stateCode);

  const weekStart = startOfWeekISO(refDate);
  const weekEnd = endOfWeekISO(refDate);

  const totalHours = timeEntries.reduce((acc, e) => acc + (Number(e.totalHours) || 0), 0);

  await recomputeWeeklyOvertime({
    employee,
    userId,
    weekStart,
    weekEnd,
    totalHours,
    hourlyRate,
    rule,
  });
}

async function flagOffTheClockWork({ employee, userId, timestamp, activityType, metadata }) {
  const msg = `Off-the-clock work detected: ${activityType}`;
  const id = await upsertFlag({
    employee,
    userId,
    timeEntryId: "",
    type: "off_the_clock",
    severity: "violation",
    message: msg,
    metadata: { timestamp, activityType, ...(metadata || {}) },
    ruleStateCode: "",
  });

  await maybeCreateNotification({
    employee,
    userId,
    timeEntryId: "",
    complianceFlagId: id,
    type: "violation",
    message: msg,
  });
}

module.exports = {
  getRuleForState,
  evaluateMealBreakCompliance,
  evaluateOvertimeCompliance,
  flagOffTheClockWork,
  startOfWeekISO,
  endOfWeekISO,
};
