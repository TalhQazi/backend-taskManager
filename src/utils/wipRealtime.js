/**
 * Socket.IO broadcast helpers for the WIP module.
 *
 * Rooms are derived server-side from the verified JWT (see socket auth in
 * index.js). Manager-only payloads go to WIP_ROOMS.MANAGERS; TV displays get a
 * sanitized stream that never carries manager notes.
 *
 * The server broadcasts *state changes* only. Elapsed timers tick locally on
 * the client — we never emit per-second updates.
 */

const { WIP_SOCKET_EVENTS, WIP_ROOMS } = require("../constants/wip");

function io() {
  return global.io || null;
}

function emitToManagers(event, payload) {
  const server = io();
  if (!server) return;
  server.to(WIP_ROOMS.MANAGERS).emit(event, payload);
}

/** TV displays are read-only observers of grid/summary state. */
function emitToTv(event, payload) {
  const server = io();
  if (!server) return;
  server.to(WIP_ROOMS.TV).emit(event, payload);
}

function emitToEmployee(employeeId, event, payload) {
  const server = io();
  if (!server || !employeeId) return;
  server.to(WIP_ROOMS.employee(employeeId)).emit(event, payload);
}

function emitToSession(sessionId, event, payload) {
  const server = io();
  if (!server || !sessionId) return;
  server.to(WIP_ROOMS.session(sessionId)).emit(event, payload);
}

/**
 * Broadcast a session state change to everyone entitled to see it:
 * managers (full), TV (grid-safe), and the owning employee.
 */
function broadcastSessionEvent(event, session, extra = {}) {
  if (!session) return;
  const payload = {
    workSessionId: String(session._id),
    employeeId: String(session.employeeId),
    employeeName: session.employeeName,
    department: session.department,
    taskId: session.taskId ? String(session.taskId) : null,
    taskTitle: session.taskTitle,
    projectId: session.projectId ? String(session.projectId) : null,
    projectName: session.projectName,
    status: session.status,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    pausedAt: session.pausedAt,
    pausedTotalSeconds: session.pausedTotalSeconds,
    elapsedSeconds: session.elapsedSeconds,
    progressPercent: session.progressPercent,
    lastActivityAt: session.lastActivityAt,
    ...extra,
  };

  emitToManagers(event, payload);
  emitToTv(event, payload);
  emitToEmployee(session.employeeId, event, payload);
  emitToSession(session._id, event, payload);
}

/** Nudge listeners to refetch the summary facet. Cheap, debounced by clients. */
function broadcastSummaryInvalidated() {
  emitToManagers(WIP_SOCKET_EVENTS.SUMMARY_UPDATED, { at: new Date().toISOString() });
  emitToTv(WIP_SOCKET_EVENTS.SUMMARY_UPDATED, { at: new Date().toISOString() });
}

/** Activity feed entries are manager-facing only. */
function broadcastActivity(eventDoc, session) {
  emitToManagers(WIP_SOCKET_EVENTS.ACTIVITY_CREATED, {
    _id: String(eventDoc._id),
    eventType: eventDoc.eventType,
    note: eventDoc.note,
    createdAt: eventDoc.createdAt,
    createdByName: eventDoc.createdByName,
    workSessionId: String(eventDoc.workSessionId),
    session: session
      ? {
          employeeName: session.employeeName,
          taskTitle: session.taskTitle,
          projectName: session.projectName,
          department: session.department,
        }
      : null,
  });
}

/** Idle prompt goes only to the affected employee — never broadcast. */
function broadcastIdleWarning(session, tier, thresholdMinutes) {
  emitToEmployee(session.employeeId, WIP_SOCKET_EVENTS.SESSION_IDLE_WARNING, {
    workSessionId: String(session._id),
    tier,
    thresholdMinutes,
    lastActivityAt: session.lastActivityAt,
  });
}

module.exports = {
  emitToManagers,
  emitToTv,
  emitToEmployee,
  emitToSession,
  broadcastSessionEvent,
  broadcastSummaryInvalidated,
  broadcastActivity,
  broadcastIdleWarning,
};
