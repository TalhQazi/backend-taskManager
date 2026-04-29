const WorkSchedule = require("../models/WorkSchedule");
const User = require("../models/User");
const TimeEntry = require("../models/TimeEntry");
const LeaveRequest = require("../models/LeaveRequest");
const AttendanceEvent = require("../models/AttendanceEvent");
const { createNotification } = require("../utils/notifications");
const { parseHHMM, getNowPartsInTimeZone } = require("./eodEngine");

function toDateRangeUTCForTZDay(tzParts) {
  const start = new Date(Date.UTC(tzParts.year, tzParts.month - 1, tzParts.day, 0, 0, 0, 0));
  const end = new Date(Date.UTC(tzParts.year, tzParts.month - 1, tzParts.day, 23, 59, 59, 999));
  return { start, end };
}

async function ensureEventOnce({ userId, employeeId, employeeName, type, dateStart, patch }) {
  const existing = await AttendanceEvent.findOne({
    userId,
    type,
    date: { $gte: dateStart, $lte: new Date(dateStart.getTime() + 24 * 60 * 60 * 1000) },
  })
    .select("_id")
    .lean();

  if (existing) return null;

  return AttendanceEvent.create({
    userId,
    employeeId,
    employeeName,
    type,
    date: dateStart,
    ...(patch || {}),
  });
}

async function runAttendanceTick() {
  const schedules = await WorkSchedule.find({ isActive: true }).lean();
  if (!Array.isArray(schedules) || schedules.length === 0) return;

  const noticeWindowMinutes = Number(process.env.ATTENDANCE_CALLOUT_NOTICE_MINUTES || 60);

  for (const s of schedules) {
    const tz = String(s.timezone || "America/New_York");
    const now = getNowPartsInTimeZone(tz);
    if (!now) continue;

    const shiftStartMins = parseHHMM(s.shiftStart);
    if (shiftStartMins === null) continue;

    const userId = String(s.userId || "");
    if (!userId) continue;

    const user = await User.findById(userId).select("_id username name role").lean();
    if (!user) continue;

    const { start, end } = toDateRangeUTCForTZDay(now);

    const isOnLeave = await LeaveRequest.isUserOnLeave(String(user._id), start);
    if (isOnLeave) continue;

    const employeeName = String(user.name || user.username || "").trim();

    const timeEntry = await TimeEntry.findOne({
      employee: employeeName,
      date: { $gte: start, $lte: end },
    })
      .sort({ createdAt: -1 })
      .lean();

    const callOut = await AttendanceEvent.findOne({
      userId: user._id,
      type: "call_out",
      date: { $gte: start, $lte: end },
    })
      .sort({ createdAt: -1 })
      .lean();

    const nowMinutes = now.hour * 60 + now.minute;

    // Level 3: missed clock-in for scheduled shift
    if (!timeEntry?.clockInAt && !timeEntry?.clockIn) {
      if (nowMinutes > shiftStartMins + 30) {
        if (!callOut) {
          const created = await ensureEventOnce({
            userId: user._id,
            employeeId: user._id,
            employeeName,
            type: "missed_clock_in",
            dateStart: start,
            patch: {
              shiftStart: String(s.shiftStart || ""),
              shiftEnd: String(s.shiftEnd || ""),
              timezone: tz,
              level: 3,
              status: "open",
            },
          });

          if (created) {
            createNotification({
              actor: "system",
              actorRole: "system",
              action: "missed clock-in",
              resourceType: "attendance",
              resourceName: employeeName,
              details: `${employeeName} missed clock-in for scheduled shift`,
              assignees: ["manager", "admin", "super-admin"],
              resourceId: String(created._id),
            }).catch(() => {});
          }
        }
      }
    }

    // Level 4: call-out submitted too late (inside notice window)
    if (callOut) {
      const submittedAt = callOut.createdAt ? new Date(callOut.createdAt) : null;
      if (submittedAt && Number.isFinite(submittedAt.getTime())) {
        const shiftStartDate = new Date(start);
        shiftStartDate.setUTCHours(0, 0, 0, 0);

        const shiftStartLocal = parseHHMM(s.shiftStart);
        if (shiftStartLocal !== null) {
          const shiftStartUtc = new Date(start);
          shiftStartUtc.setUTCHours(0, 0, 0, 0);
          shiftStartUtc.setUTCMinutes(shiftStartLocal);

          const diffMinutes = (shiftStartUtc.getTime() - submittedAt.getTime()) / 60000;
          if (diffMinutes < noticeWindowMinutes) {
            const created = await ensureEventOnce({
              userId: user._id,
              employeeId: user._id,
              employeeName,
              type: "late_call_out",
              dateStart: start,
              patch: {
                shiftStart: String(s.shiftStart || ""),
                shiftEnd: String(s.shiftEnd || ""),
                timezone: tz,
                level: 4,
                status: "open",
                reasonCode: callOut.reasonCode || "",
                reasonText: callOut.reasonText || "",
              },
            });

            if (created) {
              createNotification({
                actor: "system",
                actorRole: "system",
                action: "late call-out",
                resourceType: "attendance",
                resourceName: employeeName,
                details: `${employeeName} submitted call-out inside the notice window`,
                assignees: ["manager", "admin", "super-admin"],
                resourceId: String(created._id),
              }).catch(() => {});
            }
          }
        }
      }
    }
  }
}

module.exports = { runAttendanceTick };
