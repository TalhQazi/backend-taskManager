/**
 * WIP reports. Every report is a MongoDB aggregation pipeline whose leading
 * $match is served by an index (see WorkSession/Blocker index definitions).
 *
 * Rule: sessions without a projectId are EXCLUDED from project reports — never
 * counted as zero, which would silently depress project averages.
 */

const mongoose = require("mongoose");
const WorkSession = require("../models/WorkSession");
const WorkSessionEvent = require("../models/WorkSessionEvent");
const Blocker = require("../models/Blocker");
const { visibilityFilter, toObjectId } = require("../lib/wipIdentity");
const { WIP_STATUS, WIP_EVENT_TYPE } = require("../constants/wip");

function dayBounds(dateStr) {
  const base = dateStr ? new Date(dateStr) : new Date();
  const start = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), 0, 0, 0, 0));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/** Daily activity: who worked, how long, on what. Uses {status, startedAt}. */
async function dailyActivity(actor, { date, department } = {}) {
  const { start, end } = dayBounds(date);
  const match = {
    startedAt: { $gte: start, $lt: end },
    ...visibilityFilter(actor),
  };
  if (department) match.department = String(department);

  return WorkSession.aggregate([
    { $match: match },
    {
      $group: {
        _id: "$employeeId",
        employeeName: { $first: "$employeeName" },
        department: { $first: "$department" },
        sessions: { $sum: 1 },
        totalSeconds: { $sum: "$elapsedSeconds" },
        laborCostCents: { $sum: "$laborCostCents" },
        completed: { $sum: { $cond: [{ $eq: ["$status", WIP_STATUS.COMPLETE] }, 1, 0] } },
        blocked: { $sum: { $cond: [{ $eq: ["$status", WIP_STATUS.BLOCKED] }, 1, 0] } },
        tasks: { $addToSet: "$taskId" },
      },
    },
    { $addFields: { distinctTasks: { $size: "$tasks" } } },
    { $project: { tasks: 0 } },
    { $sort: { totalSeconds: -1 } },
  ]);
}

/** Project labor: elapsed + cost rolled up per project. Excludes null projectId. */
async function projectLabor(actor, { projectId, from, to } = {}) {
  const match = {
    projectId: { $ne: null }, // explicit: unassigned work is excluded, not zeroed
    ...visibilityFilter(actor),
  };
  if (projectId) {
    const pid = toObjectId(projectId);
    if (pid) match.projectId = pid;
  }
  if (from || to) {
    match.startedAt = {};
    if (from) match.startedAt.$gte = new Date(from);
    if (to) match.startedAt.$lt = new Date(to);
  }

  return WorkSession.aggregate([
    { $match: match },
    {
      $group: {
        _id: "$projectId",
        projectName: { $first: "$projectName" },
        sessions: { $sum: 1 },
        totalSeconds: { $sum: "$elapsedSeconds" },
        laborCostCents: { $sum: "$laborCostCents" },
        employees: { $addToSet: "$employeeId" },
        lastActivityAt: { $max: "$lastActivityAt" },
      },
    },
    {
      $lookup: {
        from: "costsheets",
        // CostSheet.projectId is a String in the existing schema — cast to join.
        let: { pid: { $toString: "$_id" } },
        pipeline: [
          { $match: { $expr: { $eq: ["$projectId", "$$pid"] } } },
          { $project: { availableBudgetCents: 1 } },
        ],
        as: "costSheet",
      },
    },
    { $unwind: { path: "$costSheet", preserveNullAndEmptyArrays: true } },
    {
      $addFields: {
        headcount: { $size: "$employees" },
        budgetCents: { $ifNull: ["$costSheet.availableBudgetCents", null] },
        remainingBudgetCents: {
          $cond: [
            { $ifNull: ["$costSheet.availableBudgetCents", false] },
            { $subtract: ["$costSheet.availableBudgetCents", "$laborCostCents"] },
            null,
          ],
        },
      },
    },
    { $project: { employees: 0, costSheet: 0 } },
    { $sort: { laborCostCents: -1 } },
  ]);
}

/** Blocked work by age, responsible party, severity. Uses {resolvedAt, severity}. */
async function blockedWork(actor, { includeResolved = false } = {}) {
  const match = includeResolved ? {} : { resolvedAt: null };
  const now = new Date();

  return Blocker.aggregate([
    { $match: match },
    {
      $lookup: {
        from: "worksessions",
        localField: "workSessionId",
        foreignField: "_id",
        pipeline: [{ $match: visibilityFilter(actor) }, { $project: { employeeName: 1, department: 1, taskTitle: 1, projectName: 1 } }],
        as: "session",
      },
    },
    // Owners also see blockers with no linked session; everyone else is
    // restricted to sessions the visibility filter admitted (inner join).
    actor.isOwner
      ? { $unwind: { path: "$session", preserveNullAndEmptyArrays: true } }
      : { $unwind: { path: "$session", preserveNullAndEmptyArrays: false } },
    {
      $addFields: {
        ageSeconds: { $divide: [{ $subtract: [{ $ifNull: ["$resolvedAt", now] }, "$createdAt"] }, 1000] },
      },
    },
    {
      $project: {
        reason: 1, category: 1, severity: 1, blockedOn: 1, createdAt: 1,
        resolvedAt: 1, resolutionNote: 1, createdByName: 1, ageSeconds: 1,
        taskId: 1, session: 1,
      },
    },
    { $sort: { severity: -1, ageSeconds: -1 } },
  ]);
}

/**
 * Forgotten timers: sessions force-stopped, or still running well past a
 * plausible shift, or long-idle. These are candidates for manager correction.
 */
async function forgottenTimers(actor, { staleHours = 10 } = {}) {
  const cutoff = new Date(Date.now() - staleHours * 60 * 60 * 1000);

  return WorkSession.aggregate([
    {
      $match: {
        ...visibilityFilter(actor),
        $or: [
          { status: WIP_STATUS.FORCE_STOPPED },
          { endedAt: null, startedAt: { $lt: cutoff } },
          { endedAt: null, lastActivityAt: { $lt: cutoff } },
        ],
      },
    },
    {
      $addFields: {
        reason: {
          $switch: {
            branches: [
              { case: { $eq: ["$status", WIP_STATUS.FORCE_STOPPED] }, then: "force_stopped" },
              { case: { $lt: ["$lastActivityAt", cutoff] }, then: "no_activity" },
            ],
            default: "long_running",
          },
        },
      },
    },
    {
      $project: {
        employeeName: 1, department: 1, taskTitle: 1, projectName: 1,
        status: 1, startedAt: 1, endedAt: 1, lastActivityAt: 1,
        elapsedSeconds: 1, forceStopReason: 1, forceStoppedBy: 1, reason: 1,
      },
    },
    { $sort: { startedAt: 1 } },
  ]);
}

/** Everything completed today, per department. */
async function completedToday(actor, { date, department } = {}) {
  const { start, end } = dayBounds(date);
  const match = {
    status: WIP_STATUS.COMPLETE,
    endedAt: { $gte: start, $lt: end },
    ...visibilityFilter(actor),
  };
  if (department) match.department = String(department);

  return WorkSession.aggregate([
    { $match: match },
    { $sort: { endedAt: -1 } },
    {
      $project: {
        employeeName: 1, department: 1, taskId: 1, taskTitle: 1,
        projectName: 1, startedAt: 1, endedAt: 1,
        elapsedSeconds: 1, laborCostCents: 1, progressPercent: 1,
      },
    },
  ]);
}

/** Per-employee productivity over a window. Process signal, not a scorecard. */
async function employeeProductivity(actor, { from, to, department } = {}) {
  const match = { ...visibilityFilter(actor) };
  if (department) match.department = String(department);
  match.startedAt = {};
  if (from) match.startedAt.$gte = new Date(from);
  if (to) match.startedAt.$lt = new Date(to);
  if (!from && !to) delete match.startedAt;

  return WorkSession.aggregate([
    { $match: match },
    {
      $group: {
        _id: "$employeeId",
        employeeName: { $first: "$employeeName" },
        department: { $first: "$department" },
        totalSeconds: { $sum: "$elapsedSeconds" },
        pausedSeconds: { $sum: "$pausedTotalSeconds" },
        sessions: { $sum: 1 },
        completed: { $sum: { $cond: [{ $eq: ["$status", WIP_STATUS.COMPLETE] }, 1, 0] } },
        avgProgress: { $avg: "$progressPercent" },
        laborCostCents: { $sum: "$laborCostCents" },
      },
    },
    {
      $addFields: {
        utilisationPercent: {
          $cond: [
            { $gt: [{ $add: ["$totalSeconds", "$pausedSeconds"] }, 0] },
            { $multiply: [{ $divide: ["$totalSeconds", { $add: ["$totalSeconds", "$pausedSeconds"] }] }, 100] },
            0,
          ],
        },
      },
    },
    { $sort: { totalSeconds: -1 } },
  ]);
}

/** Heat map: active work by hour x weekday, from snapshot rollups. */
async function heatMap(actor, { from, to } = {}) {
  const TaskStatusSnapshot = require("../models/TaskStatusSnapshot");
  const match = {};
  if (from || to) {
    match.capturedAt = {};
    if (from) match.capturedAt.$gte = new Date(from);
    if (to) match.capturedAt.$lt = new Date(to);
  }
  if (!actor.isOwner && actor.department) match.department = actor.department;

  return TaskStatusSnapshot.aggregate([
    { $match: match },
    {
      $group: {
        _id: { dayOfWeek: "$dayOfWeek", hourOfDay: "$hourOfDay" },
        sessions: { $sum: 1 },
        totalSeconds: { $sum: "$elapsedSeconds" },
      },
    },
    { $project: { _id: 0, dayOfWeek: "$_id.dayOfWeek", hourOfDay: "$_id.hourOfDay", sessions: 1, totalSeconds: 1 } },
    { $sort: { dayOfWeek: 1, hourOfDay: 1 } },
  ]);
}

module.exports = {
  dailyActivity,
  projectLabor,
  blockedWork,
  forgottenTimers,
  completedToday,
  employeeProductivity,
  heatMap,
};
