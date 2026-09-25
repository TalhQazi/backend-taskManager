/**
 * WIP HTTP layer. Thin: validate input (zod), delegate to services, shape the
 * response. No business logic, no direct model access.
 */

const { z } = require("zod");
const repo = require("../repositories/wipRepository");
const sessionService = require("../services/wipSessionService");
const reportService = require("../services/wipReportService");
const settingsService = require("../services/wipSettingsService");
const { canReadManagerNotes } = require("../lib/wipIdentity");
const { computeElapsedSeconds, estimateFinishAt } = require("../lib/wipElapsed");
const {
  WIP_STATUS_VALUES,
  WIP_SOURCE_VALUES,
  WIP_DEVICE_TYPE_VALUES,
  BLOCKER_CATEGORY_VALUES,
  BLOCKER_SEVERITY_VALUES,
  WIP_STATUS_COLORS,
} = require("../constants/wip");

/** Wrap an async handler so thrown WipErrors become clean HTTP responses. */
const handle = (fn) => async (req, res, next) => {
  try {
    await fn(req, res, next);
  } catch (err) {
    if (err?.status) {
      return res.status(err.status).json({ error: { message: err.message, code: err.code } });
    }
    if (err?.name === "ZodError") {
      return res.status(400).json({ error: { message: "Validation failed", issues: err.issues } });
    }
    console.error("[WIP]", err);
    return res.status(500).json({ error: { message: "Internal error" } });
  }
};

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
const startSchema = z.object({
  deviceType: z.enum(WIP_DEVICE_TYPE_VALUES).optional(),
  locationId: z.string().optional(),
  locationName: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  source: z.enum(WIP_SOURCE_VALUES).optional(),
  onConflict: z.enum(["reject", "pause", "complete", "switch"]).optional(),
  clientTimestamp: z.coerce.date().optional(),
});

const noteSchema = z.object({
  body: z.string().min(1),
  managerOnly: z.boolean().optional().default(false),
  source: z.enum(WIP_SOURCE_VALUES).optional(),
});

const statusSchema = z.object({
  status: z.enum(WIP_STATUS_VALUES),
  note: z.string().optional().default(""),
  blockerId: z.string().optional().nullable(),
  source: z.enum(WIP_SOURCE_VALUES).optional(),
});

const progressSchema = z.object({
  progressPercent: z.number().min(0).max(100),
  note: z.string().optional().default(""),
  source: z.enum(WIP_SOURCE_VALUES).optional(),
});

const blockerSchema = z.object({
  reason: z.string().min(1),
  category: z.enum(BLOCKER_CATEGORY_VALUES),
  severity: z.enum(BLOCKER_SEVERITY_VALUES).optional(),
  blockedOn: z.string().optional().default(""),
  workSessionId: z.string().optional().nullable(),
});

const reassignSchema = z.object({
  newEmployeeId: z.string().min(1),
  mode: z.enum(["transfer", "end"]).optional(),
  reason: z.string().min(1),
});

/** Enrich a row with server-computed derived values the grid needs. */
function decorate(row, now = new Date()) {
  return {
    ...row,
    elapsedSeconds: computeElapsedSeconds(row, now),
    estimatedFinishAt: estimateFinishAt(row, now),
    statusColor: WIP_STATUS_COLORS[row.status] || "slate",
  };
}

// ---------------------------------------------------------------------------
// Dashboard reads
// ---------------------------------------------------------------------------
exports.getSummary = handle(async (req, res) => {
  const summary = await repo.getSummary(req.actor, req.query);
  res.json(summary);
});

exports.listSessions = handle(async (req, res) => {
  const result = await repo.listSessions(req.actor, req.query);
  const now = new Date();
  res.json({ ...result, items: result.items.map((r) => decorate(r, now)) });
});

exports.getSession = handle(async (req, res) => {
  const session = await repo.getSessionById(req.params.id);
  if (!session) return res.status(404).json({ error: { message: "Work session not found" } });

  // Drawer-lazy: history and notes only load here, never on the list endpoint.
  const [events, managerNotes] = await Promise.all([
    repo.listSessionEvents(session._id, { limit: 300 }),
    canReadManagerNotes(req.actor) ? repo.listManagerNotes(session._id) : Promise.resolve([]),
  ]);

  res.json({
    session: decorate(session),
    events,
    // Employees never receive this key at all — not an empty array they could probe.
    ...(canReadManagerNotes(req.actor) ? { managerNotes } : {}),
  });
});

exports.getActivityFeed = handle(async (req, res) => {
  const items = await repo.getActivityFeed(req.actor, req.query);
  res.json({ items });
});

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------
exports.startSession = handle(async (req, res) => {
  const body = startSchema.parse(req.body || {});
  const session = await sessionService.startSession(req.actor, req.params.taskId, body);
  res.status(201).json({ session: decorate(session.toObject()) });
});

exports.pauseSession = handle(async (req, res) => {
  const session = await sessionService.pauseSession(req.actor, req.params.id, req.body || {});
  res.json({ session: decorate(session.toObject()) });
});

exports.resumeSession = handle(async (req, res) => {
  const session = await sessionService.resumeSession(req.actor, req.params.id, req.body || {});
  res.json({ session: decorate(session.toObject()) });
});

exports.changeStatus = handle(async (req, res) => {
  const { status, ...rest } = statusSchema.parse(req.body || {});
  const session = await sessionService.changeStatus(req.actor, req.params.id, status, rest);
  res.json({ session: decorate(session.toObject()) });
});

exports.updateProgress = handle(async (req, res) => {
  const { progressPercent, ...rest } = progressSchema.parse(req.body || {});
  const session = await sessionService.updateProgress(req.actor, req.params.id, progressPercent, rest);
  res.json({ session: decorate(session.toObject()) });
});

exports.completeSession = handle(async (req, res) => {
  const session = await sessionService.completeSession(req.actor, req.params.id, req.body || {});
  res.json({ session: decorate(session.toObject()) });
});

exports.forceStopSession = handle(async (req, res) => {
  const session = await sessionService.forceStopSession(req.actor, req.params.id, req.body || {});
  res.json({ session: decorate(session.toObject()) });
});

exports.heartbeat = handle(async (req, res) => {
  const session = await sessionService.heartbeat(req.actor, req.params.id, req.body || {});
  res.json({ ok: true, lastActivityAt: session.lastActivityAt, elapsedSeconds: session.elapsedSeconds });
});

// ---------------------------------------------------------------------------
// Collaboration
// ---------------------------------------------------------------------------
exports.addNote = handle(async (req, res) => {
  const body = noteSchema.parse(req.body || {});
  const result = await sessionService.addNote(req.actor, req.params.id, body);
  res.status(201).json({ ok: true, managerOnly: result.managerOnly });
});

exports.addUpload = handle(async (req, res) => {
  const result = await sessionService.addUpload(req.actor, req.params.id, req.body || {});
  res.status(201).json({ ok: true, eventId: String(result.event._id) });
});

exports.requestUpdate = handle(async (req, res) => {
  const result = await sessionService.requestUpdate(req.actor, req.params.id, req.body || {});
  res.status(201).json({ ok: true, eventId: String(result.event._id) });
});

exports.respondToUpdate = handle(async (req, res) => {
  const result = await sessionService.respondToUpdate(req.actor, req.params.id, req.body || {});
  res.status(201).json({ ok: true, eventId: String(result.event._id) });
});

exports.reassignSession = handle(async (req, res) => {
  const body = reassignSchema.parse(req.body || {});
  const result = await sessionService.reassignSession(req.actor, req.params.id, body);
  res.json({
    oldSessionId: String(result.oldSession._id),
    newSessionId: result.newSession ? String(result.newSession._id) : null,
  });
});

// ---------------------------------------------------------------------------
// Blockers
// ---------------------------------------------------------------------------
exports.addBlocker = handle(async (req, res) => {
  const body = blockerSchema.parse(req.body || {});
  const result = await sessionService.addBlocker(req.actor, req.params.taskId, body);
  res.status(201).json({ blocker: result.blocker });
});

exports.resolveBlocker = handle(async (req, res) => {
  const result = await sessionService.resolveBlocker(req.actor, req.params.id, req.body || {});
  res.json({ blocker: result.blocker });
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
exports.getSettings = handle(async (req, res) => {
  const doc = await settingsService.getSettings();
  res.json({ settings: doc });
});

exports.updateSettings = handle(async (req, res) => {
  const doc = await settingsService.updateSettings(req.actor, req.body || {});
  res.json({ settings: doc });
});

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------
exports.reportDailyActivity = handle(async (req, res) => {
  res.json({ items: await reportService.dailyActivity(req.actor, req.query) });
});
exports.reportProjectLabor = handle(async (req, res) => {
  res.json({ items: await reportService.projectLabor(req.actor, req.query) });
});
exports.reportBlockedWork = handle(async (req, res) => {
  res.json({ items: await reportService.blockedWork(req.actor, req.query) });
});
exports.reportForgottenTimers = handle(async (req, res) => {
  res.json({ items: await reportService.forgottenTimers(req.actor, req.query) });
});
exports.reportCompletedToday = handle(async (req, res) => {
  res.json({ items: await reportService.completedToday(req.actor, req.query) });
});
exports.reportProductivity = handle(async (req, res) => {
  res.json({ items: await reportService.employeeProductivity(req.actor, req.query) });
});
exports.reportHeatMap = handle(async (req, res) => {
  res.json({ items: await reportService.heatMap(req.actor, req.query) });
});
