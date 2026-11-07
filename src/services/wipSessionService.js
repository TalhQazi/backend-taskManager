/**
 * WIP session lifecycle. All business logic lives here; controllers stay thin.
 *
 * Invariants:
 *  - Every state change writes a workSessionEvent in the SAME transaction.
 *  - `startedAt` is never edited. Force-stop sets `endedAt` and appends an event.
 *  - The production clock stops only on paused/break (NON_ACCRUING_STATUSES).
 *  - The labor rate is snapshotted at start and never recomputed.
 *  - One active session per employee, guaranteed by a partial unique index.
 */

const mongoose = require("mongoose");
const WorkSession = require("../models/WorkSession");
const WorkSessionEvent = require("../models/WorkSessionEvent");
const EmployeePresence = require("../models/EmployeePresence");
const ManagerNote = require("../models/ManagerNote");
const Blocker = require("../models/Blocker");
const Task = require("../models/Task");
const Project = require("../models/Project");
const Employee = require("../models/Employee");

const { withTransaction } = require("../lib/withTransaction");
const { computeElapsedSeconds, settlePause, computeLaborCostCents, estimateFinishAt } = require("../lib/wipElapsed");
const { canManageSession, canPerformManagerAction, toObjectId } = require("../lib/wipIdentity");
const realtime = require("../utils/wipRealtime");
const { createNotification } = require("../utils/notifications");
const {
  WIP_STATUS,
  WIP_EVENT_TYPE,
  WIP_SOURCE,
  WIP_SOCKET_EVENTS,
  NON_ACCRUING_STATUSES,
  TERMINAL_STATUSES,
} = require("../constants/wip");

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------
class WipError extends Error {
  constructor(message, status = 400, code = "WIP_ERROR") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const DUPLICATE_KEY = 11000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert an Employee pay rate into integer cents-per-hour.
 * `payRate` is a free-text String in the existing schema, so parse defensively.
 * Returns null when no usable rate exists — we never guess a rate.
 */
function resolveHourlyRateCents(employee) {
  if (!employee) return null;
  const raw = String(employee.payRate ?? "").replace(/[^0-9.]/g, "");
  const value = parseFloat(raw);
  if (!Number.isFinite(value) || value <= 0) return null;

  if (employee.payType === "monthly") {
    // 40h/week * 52 / 12 = 173.33 hours per month.
    return Math.round((value / 173.333) * 100);
  }
  return Math.round(value * 100);
}

function actorFields(actor) {
  return {
    createdBy: String(actor.employeeId),
    createdByName: actor.name,
    createdByRole: actor.role,
  };
}

/** Append an immutable event. Must be called inside the caller's transaction. */
async function appendEvent(session, actor, eventType, payload = {}, dbSession = null) {
  const [event] = await WorkSessionEvent.create(
    [
      {
        workSessionId: session._id,
        eventType,
        oldValue: payload.oldValue ?? null,
        newValue: payload.newValue ?? null,
        note: payload.note || "",
        metadata: payload.metadata || {},
        source: payload.source || WIP_SOURCE.WEB,
        clientTimestamp: payload.clientTimestamp || null,
        ...actorFields(actor),
      },
    ],
    dbSession ? { session: dbSession, ordered: true } : { ordered: true }
  );
  return event;
}

/** Refresh the denormalized caches. Truth stays startedAt + events. */
function refreshCaches(session, now = new Date()) {
  session.elapsedSeconds = computeElapsedSeconds(session, now);
  session.laborCostCents = computeLaborCostCents(session.elapsedSeconds, session.laborRateSnapshotCents);
  return session;
}

async function loadSessionOr404(sessionId, dbSession = null) {
  const id = toObjectId(sessionId);
  if (!id) throw new WipError("Invalid session id", 400, "INVALID_ID");
  const q = WorkSession.findById(id);
  if (dbSession) q.session(dbSession);
  const session = await q.exec();
  if (!session) throw new WipError("Work session not found", 404, "NOT_FOUND");
  return session;
}

function assertActive(session) {
  if (session.endedAt) throw new WipError("This session has already ended", 409, "SESSION_ENDED");
}

function assertCanManage(actor, session) {
  if (!canManageSession(actor, session)) {
    throw new WipError("You do not have permission to modify this session", 403, "FORBIDDEN");
  }
}

/** Any employee action counts as an activity signal — resets the idle clock. */
async function touchActivity(session, dbSession = null) {
  const now = new Date();
  session.lastActivityAt = now;
  await EmployeePresence.updateOne(
    { employeeId: session.employeeId },
    {
      $set: { lastActivityAt: now, online: true, idleTierNotified: 0 },
      $setOnInsert: { employeeId: session.employeeId, employeeName: session.employeeName, department: session.department },
    },
    { upsert: true, ...(dbSession ? { session: dbSession } : {}) }
  );
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

/**
 * Start work on a task.
 *
 * @param {object} actor           resolved actor
 * @param {string} taskId
 * @param {object} opts            { deviceType, locationId, latitude, longitude, source, onConflict }
 *        onConflict: "reject" (default) | "pause" | "complete" | "switch"
 *        Controls what happens when the employee already has an active session.
 */
async function startSession(actor, taskId, opts = {}) {
  const tid = toObjectId(taskId);
  if (!tid) throw new WipError("Invalid task id", 400, "INVALID_ID");

  const task = await Task.findById(tid).select("title projectId priority dueDate").lean();
  if (!task) throw new WipError("Task not found", 404, "TASK_NOT_FOUND");

  const [employee, project] = await Promise.all([
    Employee.findById(actor.employeeId).select("name department payRate payType").lean(),
    task.projectId ? Project.findById(task.projectId).select("name").lean() : null,
  ]);
  if (!employee) throw new WipError("Employee not found", 404, "EMPLOYEE_NOT_FOUND");

  const onConflict = opts.onConflict || "reject";

  const created = await withTransaction(async (dbSession) => {
    // Resolve an existing active session according to the caller's choice.
    const existingQuery = WorkSession.findOne({ employeeId: actor.employeeId, endedAt: null });
    if (dbSession) existingQuery.session(dbSession);
    const existing = await existingQuery.exec();

    if (existing) {
      if (String(existing.taskId) === String(tid)) {
        throw new WipError("You are already working on this task", 409, "ALREADY_ACTIVE");
      }
      if (onConflict === "reject") {
        throw new WipError(
          "You already have an active session. Pause, complete, or switch it first.",
          409,
          "ACTIVE_SESSION_EXISTS"
        );
      }
      if (onConflict === "pause" || onConflict === "switch") {
        // The partial unique index permits exactly one open session per
        // employee, so "pause" closes this span with status=paused rather than
        // leaving it open. History is preserved; resuming the task later opens
        // a new span and its elapsed time accumulates across spans.
        await endSessionInternal(existing, actor, WIP_STATUS.PAUSED, {
          note: onConflict === "switch" ? `Switched to task: ${task.title}` : "Paused to start another task",
          eventType: WIP_EVENT_TYPE.PAUSE,
          metadata: { switchedToTaskId: String(tid) },
          dbSession,
        });
      } else if (onConflict === "complete") {
        await endSessionInternal(existing, actor, WIP_STATUS.COMPLETE, {
          note: "Completed before starting another task",
          eventType: WIP_EVENT_TYPE.COMPLETE,
          dbSession,
        });
      }
    }

    const now = new Date();
    const rate = resolveHourlyRateCents(employee);

    const [session] = await WorkSession.create(
      [
        {
          employeeId: actor.employeeId,
          employeeName: employee.name || actor.name,
          department: employee.department || actor.department || "",
          taskId: tid,
          taskTitle: task.title || "",
          projectId: task.projectId || null,
          projectName: project?.name || "",
          status: WIP_STATUS.WORKING,
          startedAt: now,
          endedAt: null, // explicit: the partial unique index depends on it
          pausedAt: null,
          pausedTotalSeconds: 0,
          elapsedSeconds: 0,
          progressPercent: 0,
          laborRateSnapshotCents: rate,
          laborCostCents: 0,
          locationId: toObjectId(opts.locationId) || null,
          locationName: opts.locationName || "",
          latitude: Number.isFinite(opts.latitude) ? opts.latitude : null,
          longitude: Number.isFinite(opts.longitude) ? opts.longitude : null,
          deviceType: opts.deviceType || "unknown",
          lastActivityAt: now,
          createdBy: String(actor.employeeId),
          updatedBy: String(actor.employeeId),
        },
      ],
      dbSession ? { session: dbSession, ordered: true } : { ordered: true }
    );

    await appendEvent(
      session,
      actor,
      WIP_EVENT_TYPE.START,
      {
        newValue: WIP_STATUS.WORKING,
        metadata: { taskId: String(tid), projectId: task.projectId ? String(task.projectId) : null, laborRateSnapshotCents: rate },
        source: opts.source || WIP_SOURCE.WEB,
        clientTimestamp: opts.clientTimestamp || null,
      },
      dbSession
    );

    await touchActivity(session, dbSession);
    return session;
  }).catch((err) => {
    // The partial unique index is the last line of defence against a racing
    // second start. Translate it into a clean 409 rather than a 500.
    if (err?.code === DUPLICATE_KEY) {
      throw new WipError("An active session already exists for this employee", 409, "ACTIVE_SESSION_EXISTS");
    }
    throw err;
  });

  realtime.broadcastSessionEvent(WIP_SOCKET_EVENTS.SESSION_STARTED, created);
  realtime.broadcastSummaryInvalidated();
  return created;
}

// ---------------------------------------------------------------------------
// Pause / Resume
// ---------------------------------------------------------------------------

async function pauseSession(actor, sessionId, { note = "", source = WIP_SOURCE.WEB, status = WIP_STATUS.PAUSED } = {}) {
  const updated = await withTransaction(async (dbSession) => {
    const session = await loadSessionOr404(sessionId, dbSession);
    assertCanManage(actor, session);
    assertActive(session);
    if (session.pausedAt) throw new WipError("Session is already paused", 409, "ALREADY_PAUSED");

    const now = new Date();
    const prev = session.status;

    session.pausedAt = now;
    session.status = NON_ACCRUING_STATUSES.includes(status) ? status : WIP_STATUS.PAUSED;
    session.updatedBy = String(actor.employeeId);
    refreshCaches(session, now);
    await touchActivity(session, dbSession);
    await session.save(dbSession ? { session: dbSession } : undefined);

    await appendEvent(
      session,
      actor,
      WIP_EVENT_TYPE.PAUSE,
      { oldValue: prev, newValue: session.status, note, source },
      dbSession
    );
    return session;
  });

  realtime.broadcastSessionEvent(WIP_SOCKET_EVENTS.SESSION_PAUSED, updated);
  realtime.broadcastSummaryInvalidated();
  return updated;
}

async function resumeSession(actor, sessionId, { note = "", source = WIP_SOURCE.WEB } = {}) {
  const updated = await withTransaction(async (dbSession) => {
    const session = await loadSessionOr404(sessionId, dbSession);
    assertCanManage(actor, session);
    assertActive(session);
    if (!session.pausedAt) throw new WipError("Session is not paused", 409, "NOT_PAUSED");

    const now = new Date();
    const prev = session.status;

    // Fold the open pause into the accumulated total, then clear it.
    session.pausedTotalSeconds = settlePause(session, now);
    session.pausedAt = null;
    session.status = WIP_STATUS.WORKING;
    session.updatedBy = String(actor.employeeId);
    refreshCaches(session, now);
    await touchActivity(session, dbSession);
    await session.save(dbSession ? { session: dbSession } : undefined);

    await appendEvent(
      session,
      actor,
      WIP_EVENT_TYPE.RESUME,
      { oldValue: prev, newValue: WIP_STATUS.WORKING, note, source, metadata: { pausedTotalSeconds: session.pausedTotalSeconds } },
      dbSession
    );
    return session;
  });

  realtime.broadcastSessionEvent(WIP_SOCKET_EVENTS.SESSION_RESUMED, updated);
  realtime.broadcastSummaryInvalidated();
  return updated;
}

// ---------------------------------------------------------------------------
// Status / Progress
// ---------------------------------------------------------------------------

async function changeStatus(actor, sessionId, nextStatus, { note = "", source = WIP_SOURCE.WEB, blockerId = null } = {}) {
  if (!Object.values(WIP_STATUS).includes(nextStatus)) {
    throw new WipError(`Unknown status: ${nextStatus}`, 400, "INVALID_STATUS");
  }
  if (TERMINAL_STATUSES.includes(nextStatus)) {
    throw new WipError("Use complete or force-stop to end a session", 400, "INVALID_STATUS");
  }
  if (nextStatus === WIP_STATUS.BLOCKED && !note) {
    throw new WipError("A reason is required to mark work blocked", 400, "REASON_REQUIRED");
  }

  const updated = await withTransaction(async (dbSession) => {
    const session = await loadSessionOr404(sessionId, dbSession);
    assertCanManage(actor, session);
    assertActive(session);

    const now = new Date();
    const prev = session.status;
    if (prev === nextStatus) return session;

    const wasPaused = NON_ACCRUING_STATUSES.includes(prev);
    const willPause = NON_ACCRUING_STATUSES.includes(nextStatus);

    // Crossing the accruing boundary starts or settles a pause.
    if (wasPaused && !willPause) {
      session.pausedTotalSeconds = settlePause(session, now);
      session.pausedAt = null;
    } else if (!wasPaused && willPause) {
      session.pausedAt = now;
    }

    session.status = nextStatus;
    if (blockerId) session.activeBlockerId = toObjectId(blockerId);
    session.updatedBy = String(actor.employeeId);
    refreshCaches(session, now);
    await touchActivity(session, dbSession);
    await session.save(dbSession ? { session: dbSession } : undefined);

    await appendEvent(
      session,
      actor,
      WIP_EVENT_TYPE.STATUS_CHANGE,
      { oldValue: prev, newValue: nextStatus, note, source },
      dbSession
    );
    return session;
  });

  realtime.broadcastSessionEvent(WIP_SOCKET_EVENTS.SESSION_STATUS_CHANGED, updated);
  realtime.broadcastSummaryInvalidated();
  return updated;
}

async function updateProgress(actor, sessionId, progressPercent, { note = "", source = WIP_SOURCE.WEB } = {}) {
  const pct = Number(progressPercent);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    throw new WipError("progressPercent must be between 0 and 100", 400, "INVALID_PROGRESS");
  }

  const updated = await withTransaction(async (dbSession) => {
    const session = await loadSessionOr404(sessionId, dbSession);
    assertCanManage(actor, session);
    assertActive(session);

    const now = new Date();
    const prev = session.progressPercent;
    session.progressPercent = Math.round(pct);
    session.updatedBy = String(actor.employeeId);
    refreshCaches(session, now);
    await touchActivity(session, dbSession);
    await session.save(dbSession ? { session: dbSession } : undefined);

    await appendEvent(
      session,
      actor,
      WIP_EVENT_TYPE.PROGRESS_UPDATE,
      { oldValue: prev, newValue: session.progressPercent, note, source },
      dbSession
    );
    return session;
  });

  realtime.broadcastSessionEvent(WIP_SOCKET_EVENTS.SESSION_PROGRESS_UPDATED, updated, {
    estimatedFinishAt: estimateFinishAt(updated),
  });
  return updated;
}

// ---------------------------------------------------------------------------
// End of life: complete / force stop
// ---------------------------------------------------------------------------

/** Shared terminal path. `startedAt` is never touched. */
async function endSessionInternal(session, actor, finalStatus, { note, eventType, metadata, dbSession, source } = {}) {
  const now = new Date();

  // Settle an open pause so pausedTotalSeconds is final and auditable.
  if (session.pausedAt) {
    session.pausedTotalSeconds = settlePause(session, now);
    session.pausedAt = null;
  }

  session.endedAt = now;
  session.status = finalStatus || WIP_STATUS.COMPLETE;
  session.updatedBy = String(actor.employeeId);
  refreshCaches(session, now);
  await session.save(dbSession ? { session: dbSession } : undefined);

  await appendEvent(
    session,
    actor,
    eventType || WIP_EVENT_TYPE.COMPLETE,
    {
      oldValue: null,
      newValue: session.status,
      note: note || "",
      source: source || WIP_SOURCE.WEB,
      metadata: { elapsedSeconds: session.elapsedSeconds, laborCostCents: session.laborCostCents, ...(metadata || {}) },
    },
    dbSession
  );

  await EmployeePresence.updateOne(
    { employeeId: session.employeeId },
    { $set: { lastActivityAt: now } },
    dbSession ? { session: dbSession } : {}
  );

  return session;
}

async function completeSession(actor, sessionId, { note = "", progressPercent, source = WIP_SOURCE.WEB } = {}) {
  const updated = await withTransaction(async (dbSession) => {
    const session = await loadSessionOr404(sessionId, dbSession);
    assertCanManage(actor, session);
    assertActive(session);

    if (Number.isFinite(Number(progressPercent))) {
      session.progressPercent = Math.min(100, Math.max(0, Math.round(Number(progressPercent))));
    } else {
      session.progressPercent = 100;
    }

    return endSessionInternal(session, actor, WIP_STATUS.COMPLETE, {
      note,
      eventType: WIP_EVENT_TYPE.COMPLETE,
      dbSession,
      source,
    });
  });

  realtime.broadcastSessionEvent(WIP_SOCKET_EVENTS.SESSION_COMPLETED, updated);
  realtime.broadcastSummaryInvalidated();
  return updated;
}

/**
 * Manager-only. Reason mandatory. The original timeline is preserved untouched:
 * we set endedAt and append a force_stop event; startedAt is never edited.
 */
async function forceStopSession(actor, sessionId, { reason, source = WIP_SOURCE.MANAGER } = {}) {
  if (!reason || !String(reason).trim()) {
    throw new WipError("A reason is required to force stop a session", 400, "REASON_REQUIRED");
  }

  const updated = await withTransaction(async (dbSession) => {
    const session = await loadSessionOr404(sessionId, dbSession);
    if (!canPerformManagerAction(actor, session)) {
      throw new WipError("Only a manager or owner may force stop a session", 403, "FORBIDDEN");
    }
    assertActive(session);

    session.forceStoppedBy = String(actor.employeeId);
    session.forceStopReason = String(reason).trim();

    return endSessionInternal(session, actor, WIP_STATUS.FORCE_STOPPED, {
      note: session.forceStopReason,
      eventType: WIP_EVENT_TYPE.FORCE_STOP,
      metadata: { forcedBy: actor.name, reason: session.forceStopReason },
      dbSession,
      source,
    });
  });

  realtime.broadcastSessionEvent(WIP_SOCKET_EVENTS.SESSION_COMPLETED, updated, { forceStopped: true });
  realtime.broadcastSummaryInvalidated();

  await safeNotify({
    actor,
    action: "force stopped your timer",
    resourceName: updated.taskTitle,
    resourceId: String(updated._id),
    recipients: [updated.employeeName],
    details: `Reason: ${updated.forceStopReason}`,
  });

  return updated;
}

// ---------------------------------------------------------------------------
// Notes, uploads, update requests
// ---------------------------------------------------------------------------

/**
 * A note. When `managerOnly` is true it lands in the private managerNotes
 * collection and NEVER in the shared event stream body.
 */
async function addNote(actor, sessionId, { body, managerOnly = false, source = WIP_SOURCE.WEB } = {}) {
  if (!body || !String(body).trim()) throw new WipError("Note body is required", 400, "BODY_REQUIRED");

  const result = await withTransaction(async (dbSession) => {
    const session = await loadSessionOr404(sessionId, dbSession);

    if (managerOnly) {
      if (!canPerformManagerAction(actor, session)) {
        throw new WipError("Only a manager or owner may add manager notes", 403, "FORBIDDEN");
      }
      const [note] = await ManagerNote.create(
        [
          {
            workSessionId: session._id,
            taskId: session.taskId,
            projectId: session.projectId,
            employeeId: session.employeeId,
            body: String(body).trim(),
            createdBy: String(actor.employeeId),
            createdByName: actor.name,
            createdByRole: actor.role,
          },
        ],
        dbSession ? { session: dbSession, ordered: true } : { ordered: true }
      );
      // The event records that a private note exists — not its contents.
      await appendEvent(
        session,
        actor,
        WIP_EVENT_TYPE.NOTE,
        { note: "", metadata: { managerOnly: true, managerNoteId: String(note._id) }, source },
        dbSession
      );
      return { note, session, managerOnly: true };
    }

    assertCanManage(actor, session);
    await touchActivity(session, dbSession);
    await session.save(dbSession ? { session: dbSession } : undefined);
    const event = await appendEvent(
      session,
      actor,
      WIP_EVENT_TYPE.NOTE,
      { note: String(body).trim(), source },
      dbSession
    );
    return { event, session, managerOnly: false };
  });

  if (!result.managerOnly) realtime.broadcastActivity(result.event, result.session);
  return result;
}

/** Attach an already-uploaded file (S3 url from lib/s3.js) to the timeline. */
async function addUpload(actor, sessionId, { files = [], note = "", source = WIP_SOURCE.WEB } = {}) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new WipError("At least one file is required", 400, "FILES_REQUIRED");
  }

  const result = await withTransaction(async (dbSession) => {
    const session = await loadSessionOr404(sessionId, dbSession);
    assertCanManage(actor, session);
    assertActive(session);

    await touchActivity(session, dbSession);
    await session.save(dbSession ? { session: dbSession } : undefined);

    const event = await appendEvent(
      session,
      actor,
      WIP_EVENT_TYPE.UPLOAD,
      { note, metadata: { files }, source },
      dbSession
    );
    return { event, session };
  });

  realtime.broadcastActivity(result.event, result.session);
  return result;
}

/** Manager asks the employee for a status update. Employee responds separately. */
async function requestUpdate(actor, sessionId, { message = "", source = WIP_SOURCE.MANAGER } = {}) {
  const result = await withTransaction(async (dbSession) => {
    const session = await loadSessionOr404(sessionId, dbSession);
    if (!canPerformManagerAction(actor, session)) {
      throw new WipError("Only a manager or owner may request an update", 403, "FORBIDDEN");
    }
    assertActive(session);

    const event = await appendEvent(
      session,
      actor,
      WIP_EVENT_TYPE.REQUEST_UPDATE,
      { note: message, source },
      dbSession
    );
    return { event, session };
  });

  realtime.emitToEmployee(result.session.employeeId, WIP_SOCKET_EVENTS.ACTIVITY_CREATED, {
    type: WIP_EVENT_TYPE.REQUEST_UPDATE,
    workSessionId: String(result.session._id),
    message,
    requestedBy: actor.name,
  });
  realtime.broadcastActivity(result.event, result.session);

  await safeNotify({
    actor,
    action: "requested a status update",
    resourceName: result.session.taskTitle,
    resourceId: String(result.session._id),
    recipients: [result.session.employeeName],
    details: message,
  });

  return result;
}

/** Employee's answer to a request_update. */
async function respondToUpdate(actor, sessionId, { note = "", progressPercent, blockerStatus, files = [], source = WIP_SOURCE.WEB } = {}) {
  const result = await withTransaction(async (dbSession) => {
    const session = await loadSessionOr404(sessionId, dbSession);
    assertCanManage(actor, session);
    assertActive(session);

    if (Number.isFinite(Number(progressPercent))) {
      session.progressPercent = Math.min(100, Math.max(0, Math.round(Number(progressPercent))));
    }
    await touchActivity(session, dbSession);
    refreshCaches(session);
    await session.save(dbSession ? { session: dbSession } : undefined);

    const event = await appendEvent(
      session,
      actor,
      WIP_EVENT_TYPE.RESPONSE_UPDATE,
      { note, newValue: session.progressPercent, metadata: { blockerStatus, files }, source },
      dbSession
    );
    return { event, session };
  });

  realtime.broadcastActivity(result.event, result.session);
  realtime.broadcastSessionEvent(WIP_SOCKET_EVENTS.SESSION_PROGRESS_UPDATED, result.session);
  return result;
}

// ---------------------------------------------------------------------------
// Blockers
// ---------------------------------------------------------------------------

async function addBlocker(actor, taskId, { reason, category, severity = "medium", blockedOn = "", workSessionId = null } = {}) {
  if (!reason || !String(reason).trim()) throw new WipError("A blocker reason is required", 400, "REASON_REQUIRED");
  if (!category) throw new WipError("A blocker category is required", 400, "CATEGORY_REQUIRED");

  const result = await withTransaction(async (dbSession) => {
    const session = workSessionId
      ? await loadSessionOr404(workSessionId, dbSession)
      : await WorkSession.findOne({ taskId: toObjectId(taskId), endedAt: null }).session(dbSession || null);

    if (session) assertCanManage(actor, session);

    const [blocker] = await Blocker.create(
      [
        {
          taskId: toObjectId(taskId),
          workSessionId: session?._id || null,
          projectId: session?.projectId || null,
          employeeId: session?.employeeId || null,
          reason: String(reason).trim(),
          category,
          severity,
          blockedOn,
          createdBy: String(actor.employeeId),
          createdByName: actor.name,
        },
      ],
      dbSession ? { session: dbSession, ordered: true } : { ordered: true }
    );

    if (session) {
      session.activeBlockerId = blocker._id;
      session.status = WIP_STATUS.BLOCKED;
      session.updatedBy = String(actor.employeeId);
      refreshCaches(session);
      await session.save(dbSession ? { session: dbSession } : undefined);

      await appendEvent(
        session,
        actor,
        WIP_EVENT_TYPE.BLOCKER_ADDED,
        { newValue: WIP_STATUS.BLOCKED, note: blocker.reason, metadata: { blockerId: String(blocker._id), category, severity } },
        dbSession
      );
    }
    return { blocker, session };
  });

  realtime.emitToManagers(WIP_SOCKET_EVENTS.BLOCKER_CREATED, {
    blockerId: String(result.blocker._id),
    taskId: String(result.blocker.taskId),
    reason: result.blocker.reason,
    category: result.blocker.category,
    severity: result.blocker.severity,
  });
  if (result.session) {
    realtime.broadcastSessionEvent(WIP_SOCKET_EVENTS.SESSION_STATUS_CHANGED, result.session);
  }
  realtime.broadcastSummaryInvalidated();

  // High-severity blockers escalate through the existing notification system.
  if (["high", "critical"].includes(severity)) {
    await safeNotify({
      actor,
      action: `raised a ${severity} blocker`,
      resourceName: result.session?.taskTitle || "a task",
      resourceId: String(result.blocker._id),
      recipients: [],
      details: `${category}: ${result.blocker.reason}`,
    });
  }

  return result;
}

async function resolveBlocker(actor, blockerId, { resolutionNote = "" } = {}) {
  const result = await withTransaction(async (dbSession) => {
    const id = toObjectId(blockerId);
    const q = Blocker.findById(id);
    if (dbSession) q.session(dbSession);
    const blocker = await q.exec();
    if (!blocker) throw new WipError("Blocker not found", 404, "NOT_FOUND");
    if (blocker.resolvedAt) throw new WipError("Blocker is already resolved", 409, "ALREADY_RESOLVED");

    blocker.resolvedAt = new Date();
    blocker.resolvedBy = String(actor.employeeId);
    blocker.resolutionNote = resolutionNote;
    await blocker.save(dbSession ? { session: dbSession } : undefined);

    let session = null;
    if (blocker.workSessionId) {
      session = await loadSessionOr404(blocker.workSessionId, dbSession);
      if (!session.endedAt) {
        session.activeBlockerId = null;
        session.status = WIP_STATUS.WORKING;
        refreshCaches(session);
        await session.save(dbSession ? { session: dbSession } : undefined);

        await appendEvent(
          session,
          actor,
          WIP_EVENT_TYPE.BLOCKER_REMOVED,
          { oldValue: WIP_STATUS.BLOCKED, newValue: WIP_STATUS.WORKING, note: resolutionNote, metadata: { blockerId: String(blocker._id) } },
          dbSession
        );
      }
    }
    return { blocker, session };
  });

  realtime.emitToManagers(WIP_SOCKET_EVENTS.BLOCKER_RESOLVED, { blockerId: String(result.blocker._id) });
  if (result.session) realtime.broadcastSessionEvent(WIP_SOCKET_EVENTS.SESSION_STATUS_CHANGED, result.session);
  realtime.broadcastSummaryInvalidated();
  return result;
}

// ---------------------------------------------------------------------------
// Reassignment
// ---------------------------------------------------------------------------

/**
 * Manager reassigns active work.
 *  mode "transfer" — end the old session, open a fresh one for the new employee
 *  mode "end"      — end the old session only
 * Either way both employees' histories reflect it.
 */
async function reassignSession(actor, sessionId, { newEmployeeId, mode = "transfer", reason = "" } = {}) {
  const targetId = toObjectId(newEmployeeId);
  if (!targetId) throw new WipError("A valid newEmployeeId is required", 400, "INVALID_ID");
  if (!reason.trim()) throw new WipError("A reason is required to reassign active work", 400, "REASON_REQUIRED");

  const result = await withTransaction(async (dbSession) => {
    const session = await loadSessionOr404(sessionId, dbSession);
    if (!canPerformManagerAction(actor, session)) {
      throw new WipError("Only a manager or owner may reassign a session", 403, "FORBIDDEN");
    }
    assertActive(session);

    const newEmployee = await Employee.findById(targetId).select("name department payRate payType").lean();
    if (!newEmployee) throw new WipError("Target employee not found", 404, "EMPLOYEE_NOT_FOUND");

    const oldEmployeeId = session.employeeId;

    await endSessionInternal(session, actor, WIP_STATUS.COMPLETE, {
      note: reason,
      eventType: WIP_EVENT_TYPE.REASSIGNED,
      metadata: { from: String(oldEmployeeId), to: String(targetId), mode },
      dbSession,
      source: WIP_SOURCE.MANAGER,
    });

    if (mode !== "transfer") return { oldSession: session, newSession: null };

    const now = new Date();
    const [fresh] = await WorkSession.create(
      [
        {
          employeeId: targetId,
          employeeName: newEmployee.name,
          department: newEmployee.department || "",
          taskId: session.taskId,
          taskTitle: session.taskTitle,
          projectId: session.projectId,
          projectName: session.projectName,
          status: WIP_STATUS.WORKING,
          startedAt: now,
          endedAt: null,
          pausedTotalSeconds: 0,
          progressPercent: session.progressPercent,
          laborRateSnapshotCents: resolveHourlyRateCents(newEmployee),
          locationId: session.locationId,
          locationName: session.locationName,
          deviceType: "unknown",
          lastActivityAt: now,
          createdBy: String(actor.employeeId),
          updatedBy: String(actor.employeeId),
        },
      ],
      dbSession ? { session: dbSession, ordered: true } : { ordered: true }
    );

    await appendEvent(
      fresh,
      actor,
      WIP_EVENT_TYPE.REASSIGNED,
      { note: reason, metadata: { from: String(oldEmployeeId), to: String(targetId), previousSessionId: String(session._id) }, source: WIP_SOURCE.MANAGER },
      dbSession
    );

    return { oldSession: session, newSession: fresh };
  }).catch((err) => {
    if (err?.code === DUPLICATE_KEY) {
      throw new WipError("The target employee already has an active session", 409, "ACTIVE_SESSION_EXISTS");
    }
    throw err;
  });

  realtime.broadcastSessionEvent(WIP_SOCKET_EVENTS.SESSION_COMPLETED, result.oldSession);
  if (result.newSession) realtime.broadcastSessionEvent(WIP_SOCKET_EVENTS.SESSION_STARTED, result.newSession);
  realtime.broadcastSummaryInvalidated();
  return result;
}

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

/**
 * Client liveness ping. Refreshes lastActivityAt and the elapsed/cost caches.
 * Called every 30-60s — never every second.
 */
async function heartbeat(actor, sessionId, { deviceType, latitude, longitude } = {}) {
  const session = await loadSessionOr404(sessionId);
  assertCanManage(actor, session);
  if (session.endedAt) return session;

  const now = new Date();
  session.lastActivityAt = now;
  if (deviceType) session.deviceType = deviceType;
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    session.latitude = latitude;
    session.longitude = longitude;
  }
  refreshCaches(session, now);
  await session.save();
  await touchActivity(session);
  return session;
}

// ---------------------------------------------------------------------------
// Notification bridge — reuse the existing system, never a parallel one.
// ---------------------------------------------------------------------------
async function safeNotify({ actor, action, resourceName, resourceId, recipients, details }) {
  try {
    await createNotification({
      actor: actor.name || actor.email,
      actorRole: actor.role,
      action,
      resourceType: "work-session",
      resourceName: resourceName || "",
      resourceId: resourceId || "",
      assignees: recipients || [],
      details: details || "",
      category: "WIP",
    });
  } catch (err) {
    // Notifications must never break the audited write that already committed.
    console.error("[WIP] notification dispatch failed:", err.message);
  }
}

module.exports = {
  WipError,
  startSession,
  pauseSession,
  resumeSession,
  changeStatus,
  updateProgress,
  completeSession,
  forceStopSession,
  addNote,
  addUpload,
  requestUpdate,
  respondToUpdate,
  addBlocker,
  resolveBlocker,
  reassignSession,
  heartbeat,
  resolveHourlyRateCents,
};
