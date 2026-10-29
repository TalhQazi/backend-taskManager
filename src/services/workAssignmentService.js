const mongoose = require("mongoose");
const WorkAssignment = require("../models/WorkAssignment");
const WorkSessionSegment = require("../models/WorkSessionSegment");
const WorkActivityEvent = require("../models/WorkActivityEvent");
const Employee = require("../models/Employee");
const Task = require("../models/Task");
const Project = require("../models/Project");
const Settings = require("../models/Settings");

const toObjectId = (id) => {
  if (!id) return null;
  if (id instanceof mongoose.Types.ObjectId) return id;
  const s = String(id);
  return mongoose.Types.ObjectId.isValid(s) ? new mongoose.Types.ObjectId(s) : null;
};

/**
 * Emit real-time events through Socket.IO if available
 */
function emitLiveEvent(eventName, payload) {
  try {
    if (global.io) {
      // Broadcast to managers room
      global.io.to("wip:managers").emit(eventName, payload);
      // Broadcast to specific employee room if employeeId present
      if (payload?.employeeId) {
        global.io.to(`wip:employee:${payload.employeeId}`).emit(eventName, payload);
      }
      // General workforce broadcast
      global.io.emit(eventName, payload);
    }
  } catch (err) {
    console.error(`[Socket.io Broadcast Error on ${eventName}]:`, err.message);
  }
}

/**
 * Compute active elapsed duration and metrics strictly from segments and timestamps
 */
function computeAssignmentMetrics(assignment, segments = [], now = new Date()) {
  if (!assignment) return null;

  let closedActiveSeconds = 0;
  let currentOpenActiveSeconds = 0;
  let isOpenActive = false;

  const nowMs = now.getTime();

  segments.forEach((seg) => {
    if (seg.segmentType === "ACTIVE") {
      if (seg.endedAtUtc) {
        const segDuration = seg.durationSeconds > 0
          ? seg.durationSeconds
          : Math.max(0, Math.floor((new Date(seg.endedAtUtc).getTime() - new Date(seg.startedAtUtc).getTime()) / 1000));
        closedActiveSeconds += segDuration;
      } else {
        isOpenActive = true;
        const startMs = new Date(seg.startedAtUtc).getTime();
        if (nowMs > startMs) {
          currentOpenActiveSeconds += Math.floor((nowMs - startMs) / 1000);
        }
      }
    }
  });

  const activeElapsedSeconds = closedActiveSeconds + currentOpenActiveSeconds;
  const expectedActiveSeconds = Number(assignment.expectedActiveSeconds) || 0;

  const remainingActiveSeconds = expectedActiveSeconds > 0
    ? Math.max(0, expectedActiveSeconds - activeElapsedSeconds)
    : 0;

  // Overdue check
  let isOverdue = false;
  let overrunSeconds = 0;

  if (expectedActiveSeconds > 0 && activeElapsedSeconds > expectedActiveSeconds) {
    isOverdue = true;
    overrunSeconds = activeElapsedSeconds - expectedActiveSeconds;
  } else if (assignment.expectedCompletionAt && nowMs > new Date(assignment.expectedCompletionAt).getTime()) {
    if (assignment.status !== "COMPLETED" && assignment.status !== "CANCELLED") {
      isOverdue = true;
      overrunSeconds = Math.floor((nowMs - new Date(assignment.expectedCompletionAt).getTime()) / 1000);
    }
  }

  // Health indicator
  let health = "on-track";
  if (assignment.status === "BLOCKED") {
    health = "blocked";
  } else if (isOverdue) {
    health = "overdue";
  } else if (assignment.status === "PAUSED" || assignment.status === "BREAK") {
    health = "paused";
  } else if (assignment.status === "REVIEW") {
    health = "review";
  } else if (assignment.status === "COMPLETED") {
    health = "completed";
  }

  // Calculated expected completion
  let expectedCompletionAt = assignment.expectedCompletionAt;
  if (!expectedCompletionAt && expectedActiveSeconds > 0) {
    expectedCompletionAt = new Date(nowMs + remainingActiveSeconds * 1000);
  }

  return {
    id: String(assignment._id),
    employeeId: String(assignment.employeeId),
    projectId: assignment.projectId ? String(assignment.projectId) : null,
    projectName: assignment.projectName || "General Project",
    taskId: assignment.taskId ? String(assignment.taskId) : null,
    taskTitle: assignment.taskTitle || "General Work Assignment",
    subtaskTitle: assignment.subtaskTitle || "",
    status: assignment.status,
    priority: assignment.priority || "medium",
    progressPercent: Number(assignment.progressPercent) || 0,
    progressSource: assignment.progressSource || "MANUAL",
    startedAt: assignment.actualStartedAt || assignment.createdAt,
    activeElapsedSeconds,
    expectedActiveSeconds,
    expectedCompletionAt,
    remainingActiveSeconds,
    overrunSeconds,
    isOverdue,
    health,
    blockedReason: assignment.blockedReason || "",
    pausedReason: assignment.pausedReason || "",
    queuePosition: assignment.queuePosition || 0,
    isOpenActive,
  };
}

/**
 * Create a new assignment
 */
async function createAssignment(data, actor = {}) {
  const employeeId = toObjectId(data.employeeId);
  if (!employeeId) throw new Error("Valid employeeId is required");

  const employee = await Employee.findById(employeeId).lean();
  if (!employee) throw new Error("Employee not found");

  let projectName = data.projectName || "";
  let taskTitle = data.taskTitle || "";

  if (data.projectId && !projectName) {
    const proj = await Project.findById(data.projectId).select("name").lean();
    if (proj) projectName = proj.name;
  }

  if (data.taskId && !taskTitle) {
    const t = await Task.findById(data.taskId).select("title").lean();
    if (t) taskTitle = t.title;
  }

  // Count existing queued assignments for this employee to set next queue position
  const existingCount = await WorkAssignment.countDocuments({
    employeeId,
    status: { $nin: ["COMPLETED", "CANCELLED"] },
  });

  const assignment = await WorkAssignment.create({
    employeeId,
    employeeName: employee.name,
    department: employee.department || "",
    projectId: toObjectId(data.projectId),
    projectName,
    taskId: toObjectId(data.taskId),
    taskTitle,
    subtaskTitle: data.subtaskTitle || "",
    status: data.status || "ASSIGNED",
    priority: data.priority || "medium",
    expectedActiveSeconds: Number(data.expectedActiveSeconds) || 0,
    expectedCompletionAt: data.expectedCompletionAt ? new Date(data.expectedCompletionAt) : null,
    plannedStartAt: data.plannedStartAt ? new Date(data.plannedStartAt) : null,
    queuePosition: data.queuePosition !== undefined ? Number(data.queuePosition) : existingCount,
    notes: data.notes || "",
    createdBy: actor.employeeId ? String(actor.employeeId) : "system",
    createdByName: actor.name || "Manager",
    createdByRole: actor.role || "admin",
  });

  // Write immutable audit event
  await WorkActivityEvent.create({
    eventType: "assignment_created",
    actorUserId: actor.employeeId ? String(actor.employeeId) : "system",
    actorName: actor.name || "Manager",
    actorRole: actor.role || "admin",
    employeeId,
    assignmentId: assignment._id,
    previousState: null,
    newState: assignment.status,
    note: `Assignment created: ${taskTitle || projectName || "New Task"}`,
    serverTimestampUtc: new Date(),
  });

  emitLiveEvent("employee.live.updated", {
    employeeId: String(employeeId),
    assignmentId: String(assignment._id),
    status: assignment.status,
    serverTime: new Date().toISOString(),
  });

  return assignment;
}

/**
 * Start or resume an assignment
 */
async function startAssignment(assignmentId, actor = {}, correlationId = "") {
  const aId = toObjectId(assignmentId);
  const assignment = await WorkAssignment.findById(aId);
  if (!assignment) throw new Error("Assignment not found");

  if (["COMPLETED", "CANCELLED"].includes(assignment.status)) {
    throw new Error(`Cannot start assignment in status ${assignment.status}`);
  }

  const now = new Date();
  const employeeId = assignment.employeeId;

  // Close any existing open ACTIVE or other segments for this employee to prevent overlapping segments
  const openSegments = await WorkSessionSegment.find({
    employeeId,
    endedAtUtc: null,
  });

  for (const seg of openSegments) {
    const duration = Math.max(0, Math.floor((now.getTime() - new Date(seg.startedAtUtc).getTime()) / 1000));
    seg.endedAtUtc = now;
    seg.durationSeconds = duration;
    await seg.save();
  }

  // If another assignment was previously ACTIVE for this employee, mark it PAUSED
  await WorkAssignment.updateMany(
    {
      employeeId,
      _id: { $ne: assignment._id },
      status: "ACTIVE",
    },
    {
      $set: { status: "PAUSED", pausedReason: "Switched to another assignment", pausedAt: now },
    }
  );

  // Create new ACTIVE segment
  const activeSegment = await WorkSessionSegment.create({
    employeeId,
    assignmentId: assignment._id,
    segmentType: "ACTIVE",
    startedAtUtc: now,
    endedAtUtc: null,
    createdBy: actor.employeeId ? String(actor.employeeId) : "system",
    createdByName: actor.name || "User",
    createdByRole: actor.role || "employee",
  });

  const previousState = assignment.status;
  assignment.status = "ACTIVE";
  if (!assignment.actualStartedAt) {
    assignment.actualStartedAt = now;
  }
  assignment.pausedReason = "";
  assignment.blockedReason = "";
  await assignment.save();

  // Audit event
  await WorkActivityEvent.create({
    eventType: "work_started",
    actorUserId: actor.employeeId ? String(actor.employeeId) : "system",
    actorName: actor.name || "User",
    actorRole: actor.role || "employee",
    employeeId,
    assignmentId: assignment._id,
    previousState,
    newState: "ACTIVE",
    note: "Work started on assignment",
    serverTimestampUtc: now,
    requestCorrelationId: correlationId,
  });

  emitLiveEvent("assignment.timer.started", {
    employeeId: String(employeeId),
    assignmentId: String(assignment._id),
    status: "ACTIVE",
    serverTime: now.toISOString(),
  });
  emitLiveEvent("employee.live.updated", {
    employeeId: String(employeeId),
    assignmentId: String(assignment._id),
    status: "ACTIVE",
    serverTime: now.toISOString(),
  });

  return { assignment, activeSegment };
}

/**
 * Pause an assignment
 */
async function pauseAssignment(assignmentId, { reason = "Work paused" } = {}, actor = {}, correlationId = "") {
  const aId = toObjectId(assignmentId);
  const assignment = await WorkAssignment.findById(aId);
  if (!assignment) throw new Error("Assignment not found");

  const now = new Date();
  const employeeId = assignment.employeeId;

  // Close open ACTIVE segments
  const openActiveSegments = await WorkSessionSegment.find({
    assignmentId: assignment._id,
    segmentType: "ACTIVE",
    endedAtUtc: null,
  });

  for (const seg of openActiveSegments) {
    const duration = Math.max(0, Math.floor((now.getTime() - new Date(seg.startedAtUtc).getTime()) / 1000));
    seg.endedAtUtc = now;
    seg.durationSeconds = duration;
    await seg.save();
  }

  // Create open PAUSED segment
  await WorkSessionSegment.create({
    employeeId,
    assignmentId: assignment._id,
    segmentType: "PAUSED",
    startedAtUtc: now,
    endedAtUtc: null,
    reasonText: reason,
    createdBy: actor.employeeId ? String(actor.employeeId) : "system",
    createdByName: actor.name || "User",
    createdByRole: actor.role || "employee",
  });

  const previousState = assignment.status;
  assignment.status = "PAUSED";
  assignment.pausedReason = reason;
  assignment.pausedAt = now;
  await assignment.save();

  // Audit event
  await WorkActivityEvent.create({
    eventType: "work_paused",
    actorUserId: actor.employeeId ? String(actor.employeeId) : "system",
    actorName: actor.name || "User",
    actorRole: actor.role || "employee",
    employeeId,
    assignmentId: assignment._id,
    previousState,
    newState: "PAUSED",
    reason,
    note: reason,
    serverTimestampUtc: now,
    requestCorrelationId: correlationId,
  });

  emitLiveEvent("assignment.timer.paused", {
    employeeId: String(employeeId),
    assignmentId: String(assignment._id),
    status: "PAUSED",
    pausedReason: reason,
    serverTime: now.toISOString(),
  });
  emitLiveEvent("employee.live.updated", {
    employeeId: String(employeeId),
    assignmentId: String(assignment._id),
    status: "PAUSED",
    serverTime: now.toISOString(),
  });

  return assignment;
}

/**
 * Resume work on an assignment
 */
async function resumeAssignment(assignmentId, actor = {}, correlationId = "") {
  return startAssignment(assignmentId, actor, correlationId);
}

/**
 * Block an assignment
 */
async function blockAssignment(assignmentId, { reason } = {}, actor = {}, correlationId = "") {
  if (!reason || !reason.trim()) {
    throw new Error("A blocker reason is strictly required to block work.");
  }

  const aId = toObjectId(assignmentId);
  const assignment = await WorkAssignment.findById(aId);
  if (!assignment) throw new Error("Assignment not found");

  const now = new Date();
  const employeeId = assignment.employeeId;

  // Close open active segment
  const openActiveSegments = await WorkSessionSegment.find({
    assignmentId: assignment._id,
    endedAtUtc: null,
  });

  for (const seg of openActiveSegments) {
    const duration = Math.max(0, Math.floor((now.getTime() - new Date(seg.startedAtUtc).getTime()) / 1000));
    seg.endedAtUtc = now;
    seg.durationSeconds = duration;
    await seg.save();
  }

  // Create open BLOCKED segment
  await WorkSessionSegment.create({
    employeeId,
    assignmentId: assignment._id,
    segmentType: "BLOCKED",
    startedAtUtc: now,
    endedAtUtc: null,
    reasonText: reason.trim(),
    createdBy: actor.employeeId ? String(actor.employeeId) : "system",
    createdByName: actor.name || "User",
    createdByRole: actor.role || "employee",
  });

  const previousState = assignment.status;
  assignment.status = "BLOCKED";
  assignment.blockedReason = reason.trim();
  assignment.blockedAt = now;
  await assignment.save();

  // Audit event
  await WorkActivityEvent.create({
    eventType: "work_blocked",
    actorUserId: actor.employeeId ? String(actor.employeeId) : "system",
    actorName: actor.name || "User",
    actorRole: actor.role || "employee",
    employeeId,
    assignmentId: assignment._id,
    previousState,
    newState: "BLOCKED",
    reason: reason.trim(),
    note: `Work blocked: ${reason.trim()}`,
    serverTimestampUtc: now,
    requestCorrelationId: correlationId,
  });

  emitLiveEvent("employee.live.updated", {
    employeeId: String(employeeId),
    assignmentId: String(assignment._id),
    status: "BLOCKED",
    blockedReason: reason.trim(),
    serverTime: now.toISOString(),
  });

  return assignment;
}

/**
 * Unblock an assignment
 */
async function unblockAssignment(assignmentId, { resumeWork = true, resolution = "" } = {}, actor = {}, correlationId = "") {
  const aId = toObjectId(assignmentId);
  const assignment = await WorkAssignment.findById(aId);
  if (!assignment) throw new Error("Assignment not found");

  const now = new Date();
  const employeeId = assignment.employeeId;

  // Close open BLOCKED segments
  const openBlockedSegments = await WorkSessionSegment.find({
    assignmentId: assignment._id,
    segmentType: "BLOCKED",
    endedAtUtc: null,
  });

  for (const seg of openBlockedSegments) {
    const duration = Math.max(0, Math.floor((now.getTime() - new Date(seg.startedAtUtc).getTime()) / 1000));
    seg.endedAtUtc = now;
    seg.durationSeconds = duration;
    if (resolution) seg.reasonText = `${seg.reasonText} | Resolved: ${resolution}`;
    await seg.save();
  }

  assignment.blockedReason = "";
  assignment.blockedAt = null;

  // Audit event
  await WorkActivityEvent.create({
    eventType: "work_unblocked",
    actorUserId: actor.employeeId ? String(actor.employeeId) : "system",
    actorName: actor.name || "User",
    actorRole: actor.role || "employee",
    employeeId,
    assignmentId: assignment._id,
    previousState: "BLOCKED",
    newState: resumeWork ? "ACTIVE" : "PAUSED",
    reason: resolution || "Blocker cleared",
    note: resolution ? `Blocker resolved: ${resolution}` : "Blocker cleared",
    serverTimestampUtc: now,
    requestCorrelationId: correlationId,
  });

  if (resumeWork) {
    return startAssignment(assignmentId, actor, correlationId);
  } else {
    assignment.status = "PAUSED";
    await assignment.save();
    emitLiveEvent("employee.live.updated", {
      employeeId: String(employeeId),
      assignmentId: String(assignment._id),
      status: "PAUSED",
      serverTime: now.toISOString(),
    });
    return assignment;
  }
}

/**
 * Switch from one assignment to another
 */
async function switchAssignment(fromAssignmentId, toAssignmentId, actor = {}, correlationId = "") {
  if (String(fromAssignmentId) === String(toAssignmentId)) {
    return startAssignment(toAssignmentId, actor, correlationId);
  }

  // Pause previous assignment
  if (fromAssignmentId) {
    await pauseAssignment(
      fromAssignmentId,
      { reason: "Switched to next assignment" },
      actor,
      correlationId
    );
  }

  // Start new assignment
  const started = await startAssignment(toAssignmentId, actor, correlationId);

  // Audit switch
  await WorkActivityEvent.create({
    eventType: "project_switched",
    actorUserId: actor.employeeId ? String(actor.employeeId) : "system",
    actorName: actor.name || "User",
    actorRole: actor.role || "employee",
    employeeId: started.assignment.employeeId,
    assignmentId: started.assignment._id,
    previousState: "PAUSED",
    newState: "ACTIVE",
    note: `Switched assignment to ${started.assignment.taskTitle || started.assignment.projectName}`,
    metadata: { fromAssignmentId, toAssignmentId },
    serverTimestampUtc: new Date(),
    requestCorrelationId: correlationId,
  });

  return started;
}

/**
 * Update ETA / Expected Active Duration
 */
async function updateEstimate(assignmentId, { expectedActiveSeconds, expectedCompletionAt, reason = "" } = {}, actor = {}, correlationId = "") {
  const aId = toObjectId(assignmentId);
  const assignment = await WorkAssignment.findById(aId);
  if (!assignment) throw new Error("Assignment not found");

  const previousEstimate = {
    expectedActiveSeconds: assignment.expectedActiveSeconds,
    expectedCompletionAt: assignment.expectedCompletionAt,
  };

  if (expectedActiveSeconds !== undefined) {
    assignment.expectedActiveSeconds = Math.max(0, Number(expectedActiveSeconds) || 0);
  }

  if (expectedCompletionAt !== undefined) {
    assignment.expectedCompletionAt = expectedCompletionAt ? new Date(expectedCompletionAt) : null;
  }

  assignment.estimateVersion = (assignment.estimateVersion || 1) + 1;
  await assignment.save();

  const newEstimate = {
    expectedActiveSeconds: assignment.expectedActiveSeconds,
    expectedCompletionAt: assignment.expectedCompletionAt,
  };

  // Audit event
  await WorkActivityEvent.create({
    eventType: "eta_changed",
    actorUserId: actor.employeeId ? String(actor.employeeId) : "system",
    actorName: actor.name || "Manager",
    actorRole: actor.role || "manager",
    employeeId: assignment.employeeId,
    assignmentId: assignment._id,
    previousEstimate,
    newEstimate,
    reason: reason || "Estimate adjusted",
    note: reason || `Estimate adjusted to ${Math.round((assignment.expectedActiveSeconds || 0) / 60)} minutes`,
    serverTimestampUtc: new Date(),
    requestCorrelationId: correlationId,
  });

  emitLiveEvent("employee.live.updated", {
    employeeId: String(assignment.employeeId),
    assignmentId: String(assignment._id),
    status: assignment.status,
    expectedActiveSeconds: assignment.expectedActiveSeconds,
    expectedCompletionAt: assignment.expectedCompletionAt,
    serverTime: new Date().toISOString(),
  });

  return assignment;
}

/**
 * Update Progress Percentage and Source
 */
async function updateProgress(assignmentId, { progressPercent, progressSource = "MANUAL", note = "" } = {}, actor = {}, correlationId = "") {
  const aId = toObjectId(assignmentId);
  const assignment = await WorkAssignment.findById(aId);
  if (!assignment) throw new Error("Assignment not found");

  const val = Math.min(100, Math.max(0, Number(progressPercent) || 0));
  const oldVal = assignment.progressPercent;

  assignment.progressPercent = val;
  if (progressSource) assignment.progressSource = progressSource;

  if (val === 100 && assignment.status === "ACTIVE") {
    assignment.status = "REVIEW";
  }

  await assignment.save();

  // Audit event
  await WorkActivityEvent.create({
    eventType: "progress_updated",
    actorUserId: actor.employeeId ? String(actor.employeeId) : "system",
    actorName: actor.name || "User",
    actorRole: actor.role || "employee",
    employeeId: assignment.employeeId,
    assignmentId: assignment._id,
    previousState: `${oldVal}%`,
    newState: `${val}%`,
    note: note || `Progress updated from ${oldVal}% to ${val}% (${progressSource})`,
    serverTimestampUtc: new Date(),
    requestCorrelationId: correlationId,
  });

  emitLiveEvent("employee.live.updated", {
    employeeId: String(assignment.employeeId),
    assignmentId: String(assignment._id),
    progressPercent: val,
    progressSource: assignment.progressSource,
    status: assignment.status,
    serverTime: new Date().toISOString(),
  });

  return assignment;
}

/**
 * Complete assignment and freeze final actuals
 */
async function completeAssignment(assignmentId, actor = {}, correlationId = "") {
  const aId = toObjectId(assignmentId);
  const assignment = await WorkAssignment.findById(aId);
  if (!assignment) throw new Error("Assignment not found");

  const now = new Date();
  const employeeId = assignment.employeeId;

  // Close open ACTIVE or other segments
  const openSegments = await WorkSessionSegment.find({
    assignmentId: assignment._id,
    endedAtUtc: null,
  });

  for (const seg of openSegments) {
    const duration = Math.max(0, Math.floor((now.getTime() - new Date(seg.startedAtUtc).getTime()) / 1000));
    seg.endedAtUtc = now;
    seg.durationSeconds = duration;
    await seg.save();
  }

  const previousState = assignment.status;
  assignment.status = "COMPLETED";
  assignment.progressPercent = 100;
  assignment.actualCompletedAt = now;
  await assignment.save();

  // Audit event
  await WorkActivityEvent.create({
    eventType: "assignment_completed",
    actorUserId: actor.employeeId ? String(actor.employeeId) : "system",
    actorName: actor.name || "User",
    actorRole: actor.role || "employee",
    employeeId,
    assignmentId: assignment._id,
    previousState,
    newState: "COMPLETED",
    note: "Assignment marked completed, final duration frozen",
    serverTimestampUtc: now,
    requestCorrelationId: correlationId,
  });

  emitLiveEvent("assignment.timer.completed", {
    employeeId: String(employeeId),
    assignmentId: String(assignment._id),
    status: "COMPLETED",
    serverTime: now.toISOString(),
  });
  emitLiveEvent("employee.live.updated", {
    employeeId: String(employeeId),
    assignmentId: String(assignment._id),
    status: "COMPLETED",
    serverTime: now.toISOString(),
  });

  return assignment;
}

/**
 * Get Employee Live Overview (Screen A)
 * Highly optimized aggregate query with server-authoritative calculations,
 * search, filters, sorting, and pagination.
 */
async function getEmployeeLiveOverview({
  page = 1,
  limit = 20,
  search = "",
  department = "all",
  status = "all",
  project = "all",
  health = "all",
  sortBy = "name",
  sortDir = "asc",
  actor = {},
}) {
  const now = new Date();
  const parsedPage = Math.max(1, parseInt(page, 10) || 1);
  const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

  // Base employee query respecting department scope for managers
  const employeeQuery = {
    status: { $ne: "inactive" },
    userStatus: { $ne: "inactive" },
  };

  if (department && department !== "all") {
    employeeQuery.department = department;
  } else if (actor.isManager && !actor.isOwner && actor.department) {
    employeeQuery.department = actor.department;
  }

  if (search && search.trim()) {
    const rx = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    employeeQuery.$or = [{ name: rx }, { email: rx }, { role: rx }, { department: rx }];
  }

  // Load all matching employees (lean)
  const employees = await Employee.find(employeeQuery)
    .select("name email phone role department company status shift initials avatarUrl current_status lunch_start_time break_start_time")
    .lean();

  if (employees.length === 0) {
    return {
      summary: {
        activeEmployees: 0,
        blockedEmployees: 0,
        overdueAssignments: 0,
        availableEmployees: 0,
        employeesInReview: 0,
        totalEmployees: 0,
      },
      items: [],
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        total: 0,
        totalPages: 1,
      },
      serverTime: now.toISOString(),
    };
  }

  const employeeIds = employees.map((e) => e._id);

  // Load avatars from Settings in one batch
  const settingsDocs = await Settings.find({
    userId: { $in: employeeIds.map(String) },
  })
    .select("userId avatarUrl avatarDataUrl")
    .lean();

  const avatarMap = new Map(
    settingsDocs.map((s) => [String(s.userId), String(s.avatarDataUrl || s.avatarUrl || "").trim()])
  );

  // Load active and queued assignments for all these employees
  const assignments = await WorkAssignment.find({
    employeeId: { $in: employeeIds },
    status: { $nin: ["COMPLETED", "CANCELLED"] },
  })
    .sort({ queuePosition: 1, createdAt: 1 })
    .lean();

  const assignmentIds = assignments.map((a) => a._id);

  // Load segments for all these assignments
  const segments = assignmentIds.length > 0
    ? await WorkSessionSegment.find({
        assignmentId: { $in: assignmentIds },
      }).lean()
    : [];

  const segmentsByAssignmentId = new Map();
  segments.forEach((seg) => {
    const key = String(seg.assignmentId);
    if (!segmentsByAssignmentId.has(key)) segmentsByAssignmentId.set(key, []);
    segmentsByAssignmentId.get(key).push(seg);
  });

  // Calculate today's time window
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todaySegments = await WorkSessionSegment.find({
    employeeId: { $in: employeeIds },
    startedAtUtc: { $gte: startOfToday },
  }).lean();

  const todayMetricsByEmployee = new Map();
  todaySegments.forEach((seg) => {
    const empKey = String(seg.employeeId);
    if (!todayMetricsByEmployee.has(empKey)) {
      todayMetricsByEmployee.set(empKey, { activeSeconds: 0, blockedSeconds: 0 });
    }
    const metrics = todayMetricsByEmployee.get(empKey);
    const dur = seg.endedAtUtc
      ? seg.durationSeconds || Math.max(0, Math.floor((new Date(seg.endedAtUtc).getTime() - new Date(seg.startedAtUtc).getTime()) / 1000))
      : Math.max(0, Math.floor((now.getTime() - new Date(seg.startedAtUtc).getTime()) / 1000));

    if (seg.segmentType === "ACTIVE") {
      metrics.activeSeconds += dur;
    } else if (seg.segmentType === "BLOCKED") {
      metrics.blockedSeconds += dur;
    }
  });

  // Group assignments by employeeId
  const assignmentsByEmployee = new Map();
  assignments.forEach((a) => {
    const key = String(a.employeeId);
    if (!assignmentsByEmployee.has(key)) assignmentsByEmployee.set(key, []);
    assignmentsByEmployee.get(key).push(a);
  });

  // KPI counters
  let activeEmployees = 0;
  let blockedEmployees = 0;
  let overdueAssignments = 0;
  let availableEmployees = 0;
  let employeesInReview = 0;

  // Build unified employee live objects
  let allLiveItems = employees.map((emp) => {
    const empIdStr = String(emp._id);
    const avatarUrl = avatarMap.get(empIdStr) || emp.avatarUrl || "";
    const empAssignments = assignmentsByEmployee.get(empIdStr) || [];

    // Current assignment is either the one marked ACTIVE/BLOCKED/PAUSED/REVIEW,
    // or the one with the lowest queuePosition (0)
    let currentAssignmentDoc = empAssignments.find((a) =>
      ["ACTIVE", "BLOCKED", "PAUSED", "BREAK", "REVIEW"].includes(a.status)
    );

    if (!currentAssignmentDoc && empAssignments.length > 0) {
      currentAssignmentDoc = empAssignments[0];
    }

    // Next assignment is the one with queuePosition > current
    let nextAssignmentDoc = null;
    if (currentAssignmentDoc) {
      nextAssignmentDoc = empAssignments.find(
        (a) => String(a._id) !== String(currentAssignmentDoc._id) && a.status === "ASSIGNED"
      ) || null;
    }

    let currentMetrics = null;
    if (currentAssignmentDoc) {
      const segs = segmentsByAssignmentId.get(String(currentAssignmentDoc._id)) || [];
      currentMetrics = computeAssignmentMetrics(currentAssignmentDoc, segs, now);
    }

    let nextMetrics = null;
    if (nextAssignmentDoc) {
      let estimatedNextStartAt = null;
      if (currentMetrics && currentMetrics.expectedCompletionAt) {
        estimatedNextStartAt = currentMetrics.expectedCompletionAt;
      }
      nextMetrics = {
        id: String(nextAssignmentDoc._id),
        projectId: nextAssignmentDoc.projectId ? String(nextAssignmentDoc.projectId) : null,
        projectName: nextAssignmentDoc.projectName || "General Project",
        taskId: nextAssignmentDoc.taskId ? String(nextAssignmentDoc.taskId) : null,
        taskTitle: nextAssignmentDoc.taskTitle || "Next Assignment",
        priority: nextAssignmentDoc.priority || "medium",
        queuePosition: nextAssignmentDoc.queuePosition || 1,
        estimatedNextStartAt,
        status: nextAssignmentDoc.status,
      };
    }

    // Derive liveStatus
    let liveStatus = "AVAILABLE";
    if (emp.current_status === "BREAK" || emp.current_status === "LUNCH") {
      liveStatus = "BREAK";
    } else if (currentMetrics) {
      liveStatus = currentMetrics.status; // ACTIVE, PAUSED, BLOCKED, REVIEW, etc.
    } else if (emp.status === "on-leave") {
      liveStatus = "OFFLINE";
    }

    // Update KPI counters
    if (liveStatus === "ACTIVE") activeEmployees++;
    else if (liveStatus === "BLOCKED") blockedEmployees++;
    else if (liveStatus === "REVIEW") employeesInReview++;
    else if (liveStatus === "AVAILABLE") availableEmployees++;

    if (currentMetrics && currentMetrics.isOverdue) {
      overdueAssignments++;
    }

    const todayM = todayMetricsByEmployee.get(empIdStr) || { activeSeconds: 0, blockedSeconds: 0 };

    return {
      employee: {
        id: empIdStr,
        name: emp.name,
        initials: emp.initials || emp.name.slice(0, 2).toUpperCase(),
        email: emp.email,
        phone: emp.phone || "",
        role: emp.role || "Employee",
        department: emp.department || "General",
        company: emp.company || "",
        status: emp.status,
        shift: emp.shift || "",
        avatarUrl,
      },
      liveStatus,
      currentAssignment: currentMetrics,
      nextAssignment: nextMetrics,
      todayActiveSeconds: todayM.activeSeconds + (currentMetrics?.isOpenActive ? (currentMetrics.activeElapsedSeconds % 60) : 0),
      todayBlockedSeconds: todayM.blockedSeconds,
      serverTime: now.toISOString(),
    };
  });

  // Apply frontend filters
  if (status && status !== "all") {
    allLiveItems = allLiveItems.filter((item) =>
      item.liveStatus.toUpperCase() === status.toUpperCase()
    );
  }

  if (project && project !== "all") {
    allLiveItems = allLiveItems.filter(
      (item) =>
        item.currentAssignment?.projectId === project ||
        item.currentAssignment?.projectName?.toLowerCase().includes(project.toLowerCase())
    );
  }

  if (health && health !== "all") {
    allLiveItems = allLiveItems.filter((item) => {
      if (health === "overdue") return item.currentAssignment?.isOverdue;
      if (health === "blocked") return item.currentAssignment?.health === "blocked";
      if (health === "paused") return item.currentAssignment?.health === "paused";
      if (health === "on-track") return item.currentAssignment?.health === "on-track";
      return true;
    });
  }

  // Sorting
  allLiveItems.sort((a, b) => {
    let comparison = 0;
    if (sortBy === "name") {
      comparison = a.employee.name.localeCompare(b.employee.name);
    } else if (sortBy === "activeDuration") {
      const durA = a.currentAssignment?.activeElapsedSeconds || 0;
      const durB = b.currentAssignment?.activeElapsedSeconds || 0;
      comparison = durB - durA; // longest first
    } else if (sortBy === "eta") {
      const etaA = a.currentAssignment?.expectedCompletionAt ? new Date(a.currentAssignment.expectedCompletionAt).getTime() : Infinity;
      const etaB = b.currentAssignment?.expectedCompletionAt ? new Date(b.currentAssignment.expectedCompletionAt).getTime() : Infinity;
      comparison = etaA - etaB; // soonest first
    } else if (sortBy === "overdue") {
      const ovA = a.currentAssignment?.overrunSeconds || 0;
      const ovB = b.currentAssignment?.overrunSeconds || 0;
      comparison = ovB - ovA; // most overdue first
    } else if (sortBy === "priority") {
      const pWeights = { critical: 4, high: 3, medium: 2, low: 1 };
      const weightA = pWeights[a.currentAssignment?.priority] || 0;
      const weightB = pWeights[b.currentAssignment?.priority] || 0;
      comparison = weightB - weightA;
    } else if (sortBy === "availability") {
      comparison = a.liveStatus.localeCompare(b.liveStatus);
    }

    return sortDir === "desc" ? -comparison : comparison;
  });

  // Pagination slice
  const total = allLiveItems.length;
  const totalPages = Math.ceil(total / parsedLimit) || 1;
  const startIndex = (parsedPage - 1) * parsedLimit;
  const paginatedItems = allLiveItems.slice(startIndex, startIndex + parsedLimit);

  return {
    summary: {
      activeEmployees,
      blockedEmployees,
      overdueAssignments,
      availableEmployees,
      employeesInReview,
      totalEmployees: employees.length,
    },
    items: paginatedItems,
    pagination: {
      page: parsedPage,
      limit: parsedLimit,
      total,
      totalPages,
    },
    serverTime: now.toISOString(),
  };
}

/**
 * Get Single Employee Live Snapshot (Screen B)
 */
async function getSingleEmployeeLive(employeeId, actor = {}) {
  const empId = toObjectId(employeeId);
  if (!empId) throw new Error("Valid employee ID is required");

  const emp = await Employee.findById(empId)
    .select("name email phone role department company status shift initials avatarUrl current_status lunch_start_time break_start_time location")
    .lean();

  if (!emp) throw new Error("Employee not found");

  const now = new Date();

  // Load avatar
  const s = await Settings.findOne({ userId: String(emp._id) }).select("avatarUrl avatarDataUrl").lean();
  const avatarUrl = String(s?.avatarDataUrl || s?.avatarUrl || emp.avatarUrl || "").trim();

  // Load all assignments for this employee
  const assignments = await WorkAssignment.find({
    employeeId: emp._id,
    status: { $nin: ["COMPLETED", "CANCELLED"] },
  })
    .sort({ queuePosition: 1, createdAt: 1 })
    .lean();

  // Load segments
  const assignmentIds = assignments.map((a) => a._id);
  const segments = assignmentIds.length > 0
    ? await WorkSessionSegment.find({ assignmentId: { $in: assignmentIds } }).lean()
    : [];

  const segmentsByAssignmentId = new Map();
  segments.forEach((seg) => {
    const key = String(seg.assignmentId);
    if (!segmentsByAssignmentId.has(key)) segmentsByAssignmentId.set(key, []);
    segmentsByAssignmentId.get(key).push(seg);
  });

  let currentAssignmentDoc = assignments.find((a) =>
    ["ACTIVE", "BLOCKED", "PAUSED", "BREAK", "REVIEW"].includes(a.status)
  ) || (assignments.length > 0 ? assignments[0] : null);

  let nextAssignmentDoc = null;
  if (currentAssignmentDoc) {
    nextAssignmentDoc = assignments.find(
      (a) => String(a._id) !== String(currentAssignmentDoc._id) && a.status === "ASSIGNED"
    ) || null;
  }

  let currentMetrics = null;
  if (currentAssignmentDoc) {
    const segs = segmentsByAssignmentId.get(String(currentAssignmentDoc._id)) || [];
    currentMetrics = computeAssignmentMetrics(currentAssignmentDoc, segs, now);
  }

  let nextMetrics = null;
  if (nextAssignmentDoc) {
    nextMetrics = {
      id: String(nextAssignmentDoc._id),
      projectId: nextAssignmentDoc.projectId ? String(nextAssignmentDoc.projectId) : null,
      projectName: nextAssignmentDoc.projectName || "General Project",
      taskId: nextAssignmentDoc.taskId ? String(nextAssignmentDoc.taskId) : null,
      taskTitle: nextAssignmentDoc.taskTitle || "Next Assignment",
      priority: nextAssignmentDoc.priority || "medium",
      queuePosition: nextAssignmentDoc.queuePosition || 1,
      estimatedNextStartAt: currentMetrics?.expectedCompletionAt || null,
      status: nextAssignmentDoc.status,
    };
  }

  // Derive live status
  let liveStatus = "AVAILABLE";
  if (emp.current_status === "BREAK" || emp.current_status === "LUNCH") {
    liveStatus = "BREAK";
  } else if (currentMetrics) {
    liveStatus = currentMetrics.status;
  } else if (emp.status === "on-leave") {
    liveStatus = "OFFLINE";
  }

  // Recent activity events
  const recentActivity = await WorkActivityEvent.find({ employeeId: emp._id })
    .sort({ serverTimestampUtc: -1 })
    .limit(20)
    .lean();

  // Today's metrics
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todaySegments = await WorkSessionSegment.find({
    employeeId: emp._id,
    startedAtUtc: { $gte: startOfToday },
  }).lean();

  let totalActiveToday = 0;
  let totalBlockedToday = 0;
  let totalPausedToday = 0;

  todaySegments.forEach((seg) => {
    const dur = seg.endedAtUtc
      ? seg.durationSeconds || Math.max(0, Math.floor((new Date(seg.endedAtUtc).getTime() - new Date(seg.startedAtUtc).getTime()) / 1000))
      : Math.max(0, Math.floor((now.getTime() - new Date(seg.startedAtUtc).getTime()) / 1000));

    if (seg.segmentType === "ACTIVE") totalActiveToday += dur;
    else if (seg.segmentType === "BLOCKED") totalBlockedToday += dur;
    else if (seg.segmentType === "PAUSED") totalPausedToday += dur;
  });

  const completedTodayCount = await WorkAssignment.countDocuments({
    employeeId: emp._id,
    status: "COMPLETED",
    actualCompletedAt: { $gte: startOfToday },
  });

  return {
    employee: {
      id: String(emp._id),
      name: emp.name,
      initials: emp.initials || emp.name.slice(0, 2).toUpperCase(),
      email: emp.email,
      phone: emp.phone || "",
      role: emp.role || "Employee",
      department: emp.department || "General",
      company: emp.company || "",
      status: emp.status,
      shift: emp.shift || "",
      location: emp.location || "",
      avatarUrl,
    },
    liveStatus,
    currentAssignment: currentMetrics,
    nextAssignment: nextMetrics,
    queuedAssignments: assignments.map((a) => ({
      id: String(a._id),
      taskTitle: a.taskTitle || "Task",
      projectName: a.projectName || "Project",
      priority: a.priority,
      status: a.status,
      queuePosition: a.queuePosition,
      expectedActiveSeconds: a.expectedActiveSeconds,
      expectedCompletionAt: a.expectedCompletionAt,
      progressPercent: a.progressPercent,
    })),
    recentActivity: recentActivity.map((e) => ({
      id: e.eventId,
      eventType: e.eventType,
      actorName: e.actorName,
      actorRole: e.actorRole,
      previousState: e.previousState,
      newState: e.newState,
      reason: e.reason,
      note: e.note,
      timestamp: e.serverTimestampUtc,
      metadata: e.metadata,
    })),
    metricsToday: {
      totalActiveSeconds: totalActiveToday,
      totalBlockedSeconds: totalBlockedToday,
      totalPausedSeconds: totalPausedToday,
      completedAssignmentsCount: completedTodayCount,
    },
    serverTime: now.toISOString(),
  };
}

/**
 * Get paginated activity timeline for an employee
 */
async function getEmployeeActivityTimeline(employeeId, { page = 1, limit = 20 } = {}) {
  const empId = toObjectId(employeeId);
  if (!empId) throw new Error("Valid employee ID is required");

  const parsedPage = Math.max(1, parseInt(page, 10) || 1);
  const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (parsedPage - 1) * parsedLimit;

  const [items, total] = await Promise.all([
    WorkActivityEvent.find({ employeeId: empId })
      .sort({ serverTimestampUtc: -1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    WorkActivityEvent.countDocuments({ employeeId: empId }),
  ]);

  return {
    items: items.map((e) => ({
      id: e.eventId,
      eventType: e.eventType,
      actorName: e.actorName,
      actorRole: e.actorRole,
      previousState: e.previousState,
      newState: e.newState,
      previousEstimate: e.previousEstimate,
      newEstimate: e.newEstimate,
      reason: e.reason,
      note: e.note,
      timestamp: e.serverTimestampUtc,
      metadata: e.metadata,
    })),
    pagination: {
      page: parsedPage,
      limit: parsedLimit,
      total,
      totalPages: Math.ceil(total / parsedLimit) || 1,
    },
  };
}

module.exports = {
  createAssignment,
  startAssignment,
  pauseAssignment,
  resumeAssignment,
  blockAssignment,
  unblockAssignment,
  switchAssignment,
  updateEstimate,
  updateProgress,
  completeAssignment,
  getEmployeeLiveOverview,
  getSingleEmployeeLive,
  getEmployeeActivityTimeline,
  computeAssignmentMetrics,
};
