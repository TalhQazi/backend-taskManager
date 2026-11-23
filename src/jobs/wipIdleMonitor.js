/**
 * Idle sweep + heartbeat rollup.
 *
 * Design mandate: idle is a SIGNAL, never a verdict. Nothing here changes a
 * session's status, ends a session, or accuses anyone. Tiers 1-3 inform the
 * employee; tier 4 informs a manager that someone may need help. Copy lives in
 * the frontend IdleWarningModal and is phrased as a question.
 *
 * Runs on node-cron (already a dependency) every minute.
 */

const cron = require("node-cron");
const WorkSession = require("../models/WorkSession");
const EmployeePresence = require("../models/EmployeePresence");
const TaskStatusSnapshot = require("../models/TaskStatusSnapshot");
const { getIdleConfig, getSettings } = require("../services/wipSettingsService");
const { computeElapsedSeconds, computeLaborCostCents, idleSeconds } = require("../lib/wipElapsed");
const realtime = require("../utils/wipRealtime");
const { createNotification } = require("../utils/notifications");
const { TERMINAL_STATUSES } = require("../constants/wip");

/** Tier ladder. Higher tier wins; each fires at most once per idle stretch. */
const TIERS = [
  { tier: 1, key: "softWarningMinutes", action: "soft" },
  { tier: 2, key: "reminderMinutes", action: "reminder" },
  { tier: 3, key: "promptMinutes", action: "prompt" },
  { tier: 4, key: "managerAlertMinutes", action: "managerAlert" },
];

async function evaluateSession(session, now) {
  const cfg = await getIdleConfig(session.department);
  if (!cfg.moduleEnabled || !cfg.enabled) return;

  // Field work, driving, meetings, inspections: legitimately quiet. Suppress.
  if (cfg.excludedStatuses.includes(session.status)) return;

  const idle = idleSeconds(session, now);
  const idleMinutes = idle / 60;

  let matched = null;
  for (const t of TIERS) {
    if (idleMinutes >= cfg[t.key]) matched = { ...t, threshold: cfg[t.key] };
  }
  if (!matched) return;

  const presence = await EmployeePresence.findOne({ employeeId: session.employeeId }).select("idleTierNotified").lean();
  const alreadyNotified = presence?.idleTierNotified || 0;
  if (matched.tier <= alreadyNotified) return; // don't re-nag

  await EmployeePresence.updateOne(
    { employeeId: session.employeeId },
    { $set: { idleTierNotified: matched.tier } },
    { upsert: false }
  );

  // Tiers 1-3: talk to the employee only.
  realtime.broadcastIdleWarning(session, matched.action, matched.threshold);

  if (matched.action === "managerAlert") {
    try {
      await createNotification({
        actor: "System",
        actorRole: "system",
        action: "may need help — no activity recorded",
        resourceType: "work-session",
        resourceName: session.taskTitle || "a task",
        resourceId: String(session._id),
        assignees: [],
        details: `${session.employeeName} has had no recorded activity on "${session.taskTitle}" for ${Math.round(idleMinutes)} minutes. This may simply mean quiet, hands-on work.`,
        category: "WIP",
      });
    } catch (err) {
      console.error("[WIP idle] manager alert failed:", err.message);
    }
  }
}

/** Refresh caches + write an analytics snapshot for every open session. */
async function heartbeatRollup(session, now) {
  const elapsed = computeElapsedSeconds(session, now);
  const cost = computeLaborCostCents(elapsed, session.laborRateSnapshotCents);

  await WorkSession.updateOne(
    { _id: session._id, endedAt: null },
    { $set: { elapsedSeconds: elapsed, laborCostCents: cost } }
  );

  await TaskStatusSnapshot.create({
    workSessionId: session._id,
    taskId: session.taskId,
    projectId: session.projectId,
    employeeId: session.employeeId,
    department: session.department,
    status: session.status,
    elapsedSeconds: elapsed,
    progressPercent: session.progressPercent,
    laborCostCents: cost,
    idleSeconds: idleSeconds(session, now),
    hourOfDay: now.getUTCHours(),
    dayOfWeek: now.getUTCDay() + 1,
    capturedAt: now,
  });
}

async function sweep() {
  const now = new Date();
  try {
    const settings = await getSettings();
    if (!settings.enabled) return;

    const open = await WorkSession.find({
      endedAt: null,
      status: { $nin: TERMINAL_STATUSES },
    })
      .select("employeeId employeeName department taskId taskTitle projectId status startedAt endedAt pausedAt pausedTotalSeconds progressPercent lastActivityAt laborRateSnapshotCents")
      .lean();

    if (open.length === 0) return;

    for (const session of open) {
      await evaluateSession(session, now);
      await heartbeatRollup(session, now);
    }

    realtime.broadcastSummaryInvalidated();
  } catch (err) {
    console.error("[WIP idle] sweep failed:", err.message);
  }
}

let task = null;

/** Start the sweep. Idempotent. */
function startWipIdleMonitor() {
  if (task) return task;
  // Every minute. Snapshot cadence is coarse by design — no per-second work.
  task = cron.schedule("* * * * *", sweep, { scheduled: true });
  console.log("[WIP] idle monitor scheduled (every 60s)");
  return task;
}

function stopWipIdleMonitor() {
  if (task) {
    task.stop();
    task = null;
  }
}

module.exports = { startWipIdleMonitor, stopWipIdleMonitor, sweep };
