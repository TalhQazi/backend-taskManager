/**
 * WIP data access. Every read is an aggregation pipeline or a lean projection.
 *
 * Rules enforced here:
 *  - Visibility is a $match stage, never a post-fetch filter.
 *  - No N+1: task/project/employee context is $lookup-ed in one pass.
 *  - Manager notes are only reachable through listManagerNotes().
 *  - List endpoints stay light; history loads only for the drawer.
 */

const mongoose = require("mongoose");
const WorkSession = require("../models/WorkSession");
const WorkSessionEvent = require("../models/WorkSessionEvent");
const ManagerNote = require("../models/ManagerNote");
const Blocker = require("../models/Blocker");
const EmployeePresence = require("../models/EmployeePresence");
const { visibilityFilter, toObjectId } = require("../lib/wipIdentity");
const {
  WIP_STATUS,
  TERMINAL_STATUSES,
  ACTIVE_STATUSES,
} = require("../constants/wip");

/** Sessions that are still open (not ended). */
const ACTIVE_MATCH = { endedAt: null };

/**
 * Translate query params into an indexed $match.
 * Only whitelisted keys are honoured — no operator injection from req.query.
 */
function buildFilterMatch(query = {}) {
  const match = {};

  if (query.status) {
    const list = String(query.status).split(",").map((s) => s.trim()).filter(Boolean);
    if (list.length) match.status = list.length === 1 ? list[0] : { $in: list };
  }
  if (query.department) match.department = String(query.department);
  if (query.employee) {
    const id = toObjectId(query.employee);
    if (id) match.employeeId = id;
  }
  if (query.project) {
    const id = toObjectId(query.project);
    if (id) match.projectId = id;
  }
  if (query.location) {
    const id = toObjectId(query.location);
    if (id) match.locationId = id;
  }
  if (query.blocked === "true") match.activeBlockerId = { $ne: null };

  return match;
}

/** $lookup task + project once, projecting only what the grid renders. */
const CONTEXT_LOOKUPS = [
  {
    $lookup: {
      from: "tasks",
      localField: "taskId",
      foreignField: "_id",
      pipeline: [{ $project: { title: 1, priority: 1, dueDate: 1, status: 1, category: 1 } }],
      as: "task",
    },
  },
  { $unwind: { path: "$task", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "projects",
      localField: "projectId",
      foreignField: "_id",
      pipeline: [{ $project: { name: 1, status: 1 } }],
      as: "project",
    },
  },
  { $unwind: { path: "$project", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "employees",
      localField: "employeeId",
      foreignField: "_id",
      pipeline: [{ $project: { name: 1, department: 1, avatar: 1, email: 1, role: 1 } }],
      as: "employee",
    },
  },
  { $unwind: { path: "$employee", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "blockers",
      localField: "activeBlockerId",
      foreignField: "_id",
      pipeline: [{ $project: { reason: 1, category: 1, severity: 1, blockedOn: 1, createdAt: 1 } }],
      as: "blocker",
    },
  },
  { $unwind: { path: "$blocker", preserveNullAndEmptyArrays: true } },
];

/**
 * Summary cards. One pipeline, $facet'd so it's a single round trip.
 * Scans only active sessions via { status, startedAt } / { endedAt } indexes.
 */
async function getSummary(actor, query = {}) {
  const match = { ...ACTIVE_MATCH, ...visibilityFilter(actor), ...buildFilterMatch(query) };
  const now = new Date();

  const [result] = await WorkSession.aggregate([
    { $match: match },
    {
      $facet: {
        counts: [
          {
            $group: {
              _id: null,
              currentlyWorking: {
                $sum: { $cond: [{ $in: ["$status", ACTIVE_STATUSES] }, 1, 0] },
              },
              paused: {
                $sum: { $cond: [{ $in: ["$status", [WIP_STATUS.PAUSED, WIP_STATUS.BREAK]] }, 1, 0] },
              },
              blocked: { $sum: { $cond: [{ $eq: ["$status", WIP_STATUS.BLOCKED] }, 1, 0] } },
              runningLaborCostCents: { $sum: "$laborCostCents" },
              // Elapsed cache is good enough for an average; exact math is per-row.
              avgActiveSeconds: { $avg: "$elapsedSeconds" },
              total: { $sum: 1 },
            },
          },
        ],
        activeProjects: [
          { $match: { projectId: { $ne: null } } },
          { $group: { _id: "$projectId" } },
          { $count: "count" },
        ],
        overdue: [
          {
            $lookup: {
              from: "tasks",
              localField: "taskId",
              foreignField: "_id",
              pipeline: [{ $project: { dueDate: 1 } }],
              as: "t",
            },
          },
          { $unwind: "$t" },
          { $match: { "t.dueDate": { $lt: now } } },
          { $count: "count" },
        ],
      },
    },
  ]).allowDiskUse(false);

  const counts = result?.counts?.[0] || {};

  // Clocked-in is payroll presence, deliberately independent of task sessions.
  const presenceMatch = actor.isOwner
    ? { clockedIn: true }
    : actor.isManager && actor.department
    ? { clockedIn: true, department: actor.department }
    : { clockedIn: true, employeeId: actor.employeeId };
  const employeesClockedIn = await EmployeePresence.countDocuments(presenceMatch);

  return {
    employeesClockedIn,
    currentlyWorking: counts.currentlyWorking || 0,
    pausedTasks: counts.paused || 0,
    blockedTasks: counts.blocked || 0,
    overdueTasks: result?.overdue?.[0]?.count || 0,
    activeProjects: result?.activeProjects?.[0]?.count || 0,
    averageActiveSeconds: Math.round(counts.avgActiveSeconds || 0),
    runningLaborCostCents: counts.runningLaborCostCents || 0,
    totalActiveSessions: counts.total || 0,
    generatedAt: now,
  };
}

/**
 * Paginated grid. Search spans employee/task/project/location text.
 * Sorting is whitelisted to indexed fields to keep this off collection scans.
 */
const SORTABLE = new Set(["startedAt", "lastActivityAt", "status", "progressPercent", "elapsedSeconds"]);

async function listSessions(actor, query = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(query.limit, 10) || 50));
  const skip = (page - 1) * limit;

  const sortField = SORTABLE.has(query.sortBy) ? query.sortBy : "startedAt";
  const sortDir = query.sortDir === "asc" ? 1 : -1;

  const match = { ...ACTIVE_MATCH, ...visibilityFilter(actor), ...buildFilterMatch(query) };

  const pipeline = [{ $match: match }, ...CONTEXT_LOOKUPS];

  // Priority filter lives on the joined task, so it applies after $lookup.
  if (query.priority) {
    pipeline.push({ $match: { "task.priority": String(query.priority) } });
  }
  if (query.dueBefore) {
    const d = new Date(query.dueBefore);
    if (!Number.isNaN(d.getTime())) pipeline.push({ $match: { "task.dueDate": { $lte: d } } });
  }
  if (query.search) {
    const rx = new RegExp(String(query.search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    pipeline.push({
      $match: {
        $or: [
          { employeeName: rx },
          { taskTitle: rx },
          { projectName: rx },
          { locationName: rx },
          { "employee.name": rx },
          { "task.title": rx },
          { "project.name": rx },
        ],
      },
    });
  }

  pipeline.push({
    $project: {
      employeeId: 1,
      employeeName: { $ifNull: ["$employee.name", "$employeeName"] },
      employeeAvatar: "$employee.avatar",
      department: { $ifNull: ["$employee.department", "$department"] },
      taskId: 1,
      taskTitle: { $ifNull: ["$task.title", "$taskTitle"] },
      taskPriority: "$task.priority",
      taskDueDate: "$task.dueDate",
      projectId: 1,
      projectName: { $ifNull: ["$project.name", "$projectName"] },
      status: 1,
      startedAt: 1,
      pausedAt: 1,
      pausedTotalSeconds: 1,
      elapsedSeconds: 1,
      progressPercent: 1,
      laborCostCents: 1,
      locationId: 1,
      locationName: 1,
      lastActivityAt: 1,
      deviceType: 1,
      blocker: 1,
      createdAt: 1,
    },
  });

  pipeline.push({
    $facet: {
      items: [{ $sort: { [sortField]: sortDir, _id: 1 } }, { $skip: skip }, { $limit: limit }],
      total: [{ $count: "count" }],
    },
  });

  const [res] = await WorkSession.aggregate(pipeline).allowDiskUse(false);
  return {
    items: res?.items || [],
    total: res?.total?.[0]?.count || 0,
    page,
    limit,
  };
}

/** Single session + joined context. Drawer-lazy: history fetched separately. */
async function getSessionById(sessionId) {
  const id = toObjectId(sessionId);
  if (!id) return null;
  const [doc] = await WorkSession.aggregate([
    { $match: { _id: id } },
    ...CONTEXT_LOOKUPS,
    {
      $lookup: {
        from: "worklocations",
        localField: "locationId",
        foreignField: "_id",
        pipeline: [{ $project: { name: 1, type: 1 } }],
        as: "location",
      },
    },
    { $unwind: { path: "$location", preserveNullAndEmptyArrays: true } },
  ]);
  return doc || null;
}

/** Full immutable timeline for the drawer. Paginated, index-backed. */
async function listSessionEvents(sessionId, { limit = 200, before } = {}) {
  const id = toObjectId(sessionId);
  if (!id) return [];
  const match = { workSessionId: id };
  if (before) match.createdAt = { $lt: new Date(before) };
  return WorkSessionEvent.find(match)
    .sort({ createdAt: 1 })
    .limit(Math.min(500, limit))
    .lean();
}

/** Manager-only. Never call from an employee-scoped handler. */
async function listManagerNotes(sessionId) {
  const id = toObjectId(sessionId);
  if (!id) return [];
  return ManagerNote.find({ workSessionId: id }).sort({ createdAt: -1 }).lean();
}

/**
 * Tenant-wide activity feed, newest first, scoped to what the actor may see.
 * Joins sessions to apply visibility without post-filtering.
 */
async function getActivityFeed(actor, { since, department, project, limit = 50 } = {}) {
  const cap = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
  const eventMatch = {};
  if (since) {
    const d = new Date(since);
    if (!Number.isNaN(d.getTime())) eventMatch.createdAt = { $gt: d };
  }

  const sessionMatch = { ...visibilityFilter(actor) };
  if (department) sessionMatch.department = String(department);
  if (project) {
    const pid = toObjectId(project);
    if (pid) sessionMatch.projectId = pid;
  }

  return WorkSessionEvent.aggregate([
    { $match: eventMatch },
    { $sort: { createdAt: -1 } },
    // Bound the join: only consider recent events, then filter by visibility.
    { $limit: cap * 10 },
    {
      $lookup: {
        from: "worksessions",
        localField: "workSessionId",
        foreignField: "_id",
        pipeline: [
          { $match: sessionMatch },
          { $project: { employeeId: 1, employeeName: 1, department: 1, taskId: 1, taskTitle: 1, projectId: 1, projectName: 1, status: 1 } },
        ],
        as: "session",
      },
    },
    { $unwind: "$session" },
    { $limit: cap },
    {
      $project: {
        eventType: 1,
        oldValue: 1,
        newValue: 1,
        note: 1,
        metadata: 1,
        source: 1,
        createdBy: 1,
        createdByName: 1,
        createdByRole: 1,
        createdAt: 1,
        clientTimestamp: 1,
        workSessionId: 1,
        session: 1,
      },
    },
  ]);
}

/** Sessions whose lastActivityAt is older than `thresholdSeconds`. */
async function findIdleSessions(thresholdSeconds, excludedStatuses = []) {
  const cutoff = new Date(Date.now() - thresholdSeconds * 1000);
  return WorkSession.find({
    endedAt: null,
    lastActivityAt: { $lt: cutoff },
    status: { $nin: [...TERMINAL_STATUSES, ...excludedStatuses] },
  })
    .select("employeeId employeeName department taskId taskTitle status lastActivityAt startedAt")
    .lean();
}

/** The one open session for an employee, if any. */
async function findActiveSessionForEmployee(employeeId, session = null) {
  const id = toObjectId(employeeId);
  if (!id) return null;
  const q = WorkSession.findOne({ employeeId: id, endedAt: null });
  if (session) q.session(session);
  return q.exec();
}

module.exports = {
  getSummary,
  listSessions,
  getSessionById,
  listSessionEvents,
  listManagerNotes,
  getActivityFeed,
  findIdleSessions,
  findActiveSessionForEmployee,
  buildFilterMatch,
  ACTIVE_MATCH,
};
