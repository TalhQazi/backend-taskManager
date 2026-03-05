const TimeEntry = require("../models/TimeEntry");
const { flagOffTheClockWork } = require("./complianceEngine");

function toDateSafe(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  if (!Number.isFinite(d.getTime())) return null;
  return d;
}

async function hasActiveShiftAt({ employee, userId, at }) {
  const ts = toDateSafe(at) || new Date();

  const q = {
    clockInAt: { $lte: ts },
    $or: [{ clockOutAt: { $exists: false } }, { clockOutAt: null }, { clockOutAt: { $gte: ts } }],
  };

  if (employee) q.employee = employee;
  if (!employee && userId) q.userId = userId;

  const entry = await TimeEntry.findOne(q).sort({ clockInAt: -1 }).lean();
  return !!entry;
}

async function checkAndFlagOffTheClock({ employee, userId, timestamp, activityType, metadata }) {
  const emp = String(employee || "").trim();
  const uid = String(userId || "").trim();
  const ts = toDateSafe(timestamp) || new Date();

  if (!emp && !uid) return;

  const ok = await hasActiveShiftAt({ employee: emp || undefined, userId: uid || undefined, at: ts });
  if (ok) return;

  await flagOffTheClockWork({
    employee: emp || uid || "Unknown",
    userId: uid,
    timestamp: ts.toISOString(),
    activityType,
    metadata: metadata || {},
  });
}

module.exports = {
  checkAndFlagOffTheClock,
};
