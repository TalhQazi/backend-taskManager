/**
 * WIP Dashboard — shared constants.
 *
 * Single source of truth for every enum used by the WIP module. Mongoose does
 * not enforce enums across raw driver writes, so these values are also applied
 * as schema `enum` constraints in the models and re-exported to the frontend
 * shape via the API. Never inline a status string anywhere else.
 */

// ---------------------------------------------------------------------------
// Session statuses
// ---------------------------------------------------------------------------
const WIP_STATUS = Object.freeze({
  WORKING: "working",
  PAUSED: "paused",
  BLOCKED: "blocked",
  WAITING: "waiting",
  BREAK: "break",
  MEETING: "meeting",
  REVIEW: "review",
  COMPLETE: "complete",
  OFFLINE: "offline",
  FORCE_STOPPED: "force_stopped",
});

const WIP_STATUS_VALUES = Object.freeze(Object.values(WIP_STATUS));

/** Statuses that stop the production clock (accumulate into pausedTotalSeconds). */
const NON_ACCRUING_STATUSES = Object.freeze([WIP_STATUS.PAUSED, WIP_STATUS.BREAK]);

/** Statuses that mean the session is over. */
const TERMINAL_STATUSES = Object.freeze([WIP_STATUS.COMPLETE, WIP_STATUS.FORCE_STOPPED]);

/** Statuses counted as "actively producing" on summary cards. */
const ACTIVE_STATUSES = Object.freeze([
  WIP_STATUS.WORKING,
  WIP_STATUS.MEETING,
  WIP_STATUS.REVIEW,
  WIP_STATUS.WAITING,
]);

/** Status → display colour token. Frontend maps these to Tailwind classes. */
const WIP_STATUS_COLORS = Object.freeze({
  [WIP_STATUS.WORKING]: "green",
  [WIP_STATUS.PAUSED]: "yellow",
  [WIP_STATUS.BLOCKED]: "red",
  [WIP_STATUS.WAITING]: "orange",
  [WIP_STATUS.BREAK]: "amber",
  [WIP_STATUS.MEETING]: "blue",
  [WIP_STATUS.REVIEW]: "purple",
  [WIP_STATUS.COMPLETE]: "gray",
  [WIP_STATUS.OFFLINE]: "slate",
  [WIP_STATUS.FORCE_STOPPED]: "rose",
});

// ---------------------------------------------------------------------------
// Immutable audit event types
// ---------------------------------------------------------------------------
const WIP_EVENT_TYPE = Object.freeze({
  START: "start",
  PAUSE: "pause",
  RESUME: "resume",
  STATUS_CHANGE: "statusChange",
  PROGRESS_UPDATE: "progressUpdate",
  NOTE: "note",
  UPLOAD: "upload",
  BLOCKER_ADDED: "blockerAdded",
  BLOCKER_REMOVED: "blockerRemoved",
  REQUEST_UPDATE: "requestUpdate",
  RESPONSE_UPDATE: "responseUpdate",
  COMPLETE: "complete",
  FORCE_STOP: "forceStop",
  REASSIGNED: "reassigned",
  LOCATION_UPDATE: "locationUpdate",
  IDLE_PROMPT: "idlePrompt",
});

const WIP_EVENT_TYPE_VALUES = Object.freeze(Object.values(WIP_EVENT_TYPE));

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------
const WIP_SOURCE = Object.freeze({
  WEB: "web",
  MOBILE: "mobile",
  SYSTEM: "system",
  MANAGER: "manager",
  API: "api",
});
const WIP_SOURCE_VALUES = Object.freeze(Object.values(WIP_SOURCE));

const WIP_DEVICE_TYPE = Object.freeze({
  DESKTOP: "desktop",
  TABLET: "tablet",
  MOBILE: "mobile",
  TV: "tv",
  UNKNOWN: "unknown",
});
const WIP_DEVICE_TYPE_VALUES = Object.freeze(Object.values(WIP_DEVICE_TYPE));

// ---------------------------------------------------------------------------
// Blockers
// ---------------------------------------------------------------------------
const BLOCKER_CATEGORY_VALUES = Object.freeze([
  "parts",
  "customer",
  "vendor",
  "approval",
  "payment",
  "inspection",
  "court",
  "management_decision",
  "other",
]);

const BLOCKER_SEVERITY_VALUES = Object.freeze(["low", "medium", "high", "critical"]);

// ---------------------------------------------------------------------------
// Locations (company > location > building > room/bay/bin/shelf)
// ---------------------------------------------------------------------------
const WORK_LOCATION_TYPE_VALUES = Object.freeze([
  "company",
  "location",
  "building",
  "room",
  "bay",
  "bin",
  "shelf",
]);

// ---------------------------------------------------------------------------
// Roles (mirrors User/Employee.userRole)
// ---------------------------------------------------------------------------
const OWNER_ROLES = Object.freeze(["super-admin", "admin"]);
const MANAGER_ROLES = Object.freeze(["manager", "team-lead"]);
/** Anyone who may view the dashboard at all. */
const DASHBOARD_VIEWER_ROLES = Object.freeze([...OWNER_ROLES, ...MANAGER_ROLES]);

// ---------------------------------------------------------------------------
// Idle detection defaults (minutes). Overridable per department in settings.
// Copy note: idle is a *signal*, never an accusation. See IdleWarningModal.
// ---------------------------------------------------------------------------
const IDLE_DEFAULTS = Object.freeze({
  softWarningMinutes: 5,
  reminderMinutes: 10,
  promptMinutes: 15,
  managerAlertMinutes: 30,
  enabled: true,
});

/** Departments/roles with legitimately long quiet stretches. */
const DEFAULT_IDLE_EXCLUDED_STATUSES = Object.freeze([
  WIP_STATUS.MEETING,
  WIP_STATUS.BREAK,
  WIP_STATUS.PAUSED,
  WIP_STATUS.BLOCKED,
]);

// ---------------------------------------------------------------------------
// Socket.IO event names
// ---------------------------------------------------------------------------
const WIP_SOCKET_EVENTS = Object.freeze({
  SUMMARY_UPDATED: "wip.summary.updated",
  SESSION_STARTED: "wip.session.started",
  SESSION_PAUSED: "wip.session.paused",
  SESSION_RESUMED: "wip.session.resumed",
  SESSION_COMPLETED: "wip.session.completed",
  SESSION_PROGRESS_UPDATED: "wip.session.progressUpdated",
  SESSION_STATUS_CHANGED: "wip.session.statusChanged",
  SESSION_IDLE_WARNING: "wip.session.idleWarning",
  ACTIVITY_CREATED: "wip.activity.created",
  BLOCKER_CREATED: "wip.blocker.created",
  BLOCKER_RESOLVED: "wip.blocker.resolved",
});

/** Socket rooms. Derived server-side from the verified JWT — never client input. */
const WIP_ROOMS = Object.freeze({
  /** Managers/owners: receives full payloads including manager notes. */
  MANAGERS: "wip:managers",
  /** Read-only TV displays: summary + grid, never notes. */
  TV: "wip:tv",
  /** Per-employee room for idle prompts and update requests. */
  employee: (employeeId) => `wip:employee:${employeeId}`,
  session: (sessionId) => `wip:session:${sessionId}`,
});

module.exports = {
  WIP_STATUS,
  WIP_STATUS_VALUES,
  WIP_STATUS_COLORS,
  NON_ACCRUING_STATUSES,
  TERMINAL_STATUSES,
  ACTIVE_STATUSES,
  WIP_EVENT_TYPE,
  WIP_EVENT_TYPE_VALUES,
  WIP_SOURCE,
  WIP_SOURCE_VALUES,
  WIP_DEVICE_TYPE,
  WIP_DEVICE_TYPE_VALUES,
  BLOCKER_CATEGORY_VALUES,
  BLOCKER_SEVERITY_VALUES,
  WORK_LOCATION_TYPE_VALUES,
  OWNER_ROLES,
  MANAGER_ROLES,
  DASHBOARD_VIEWER_ROLES,
  IDLE_DEFAULTS,
  DEFAULT_IDLE_EXCLUDED_STATUSES,
  WIP_SOCKET_EVENTS,
  WIP_ROOMS,
};
