/**
 * WIP Dashboard routes.
 *
 * Mounted twice in index.js so the paths match the spec exactly:
 *   /api/dashboard/wip/*   and  /api/work-sessions/*  and  /api/tasks/:taskId/start
 *
 * Authorization ladder:
 *   requireAuth      -> valid JWT
 *   attachActor      -> resolves req.actor (employeeId, department, role)
 *   requireDashboardAccess -> manager/owner for aggregate views
 *   requireManager   -> manager/owner for interventions
 *   requireOwner     -> owner for settings writes
 * Per-session ownership is checked in the service, where the doc is loaded.
 */

const express = require("express");
const { requireAuth } = require("../middleware/auth");
const {
  attachActor,
  requireDashboardAccess,
  requireManager,
  requireOwner,
} = require("../middleware/wipPermissions");
const ctrl = require("../controllers/wipController");

// ---------------------------------------------------------------------------
// /api/dashboard/wip
// ---------------------------------------------------------------------------
const dashboardRouter = express.Router();
dashboardRouter.use(requireAuth, attachActor);

// Aggregate surfaces are manager/owner only.
dashboardRouter.get("/summary", requireDashboardAccess, ctrl.getSummary);
dashboardRouter.get("/activity-feed", requireDashboardAccess, ctrl.getActivityFeed);
dashboardRouter.get("/settings", ctrl.getSettings);
dashboardRouter.put("/settings", requireOwner, ctrl.updateSettings);

// Reports.
dashboardRouter.get("/reports/daily-activity", requireDashboardAccess, ctrl.reportDailyActivity);
dashboardRouter.get("/reports/project-labor", requireDashboardAccess, ctrl.reportProjectLabor);
dashboardRouter.get("/reports/blocked-work", requireDashboardAccess, ctrl.reportBlockedWork);
dashboardRouter.get("/reports/forgotten-timers", requireDashboardAccess, ctrl.reportForgottenTimers);
dashboardRouter.get("/reports/completed-today", requireDashboardAccess, ctrl.reportCompletedToday);
dashboardRouter.get("/reports/productivity", requireDashboardAccess, ctrl.reportProductivity);
dashboardRouter.get("/reports/heat-map", requireDashboardAccess, ctrl.reportHeatMap);

// The grid. Employees may hit this too — visibilityFilter narrows it to self.
dashboardRouter.get("/", ctrl.listSessions);
// NOTE: must be declared after the literal paths above so "summary" et al win.
dashboardRouter.get("/:id", ctrl.getSession);

// ---------------------------------------------------------------------------
// /api/work-sessions
// ---------------------------------------------------------------------------
const sessionRouter = express.Router();
sessionRouter.use(requireAuth, attachActor);

// Employee-owned actions (service enforces "own session, or manager of dept").
sessionRouter.post("/:id/pause", ctrl.pauseSession);
sessionRouter.post("/:id/resume", ctrl.resumeSession);
sessionRouter.post("/:id/status", ctrl.changeStatus);
sessionRouter.post("/:id/progress", ctrl.updateProgress);
sessionRouter.post("/:id/complete", ctrl.completeSession);
sessionRouter.post("/:id/notes", ctrl.addNote); // managerOnly flag gated in service
sessionRouter.post("/:id/uploads", ctrl.addUpload);
sessionRouter.post("/:id/respond-update", ctrl.respondToUpdate);
sessionRouter.post("/:id/heartbeat", ctrl.heartbeat);

// Manager/owner interventions.
sessionRouter.post("/:id/force-stop", requireManager, ctrl.forceStopSession);
sessionRouter.post("/:id/request-update", requireManager, ctrl.requestUpdate);
sessionRouter.post("/:id/reassign", requireManager, ctrl.reassignSession);

// ---------------------------------------------------------------------------
// /api/blockers
// ---------------------------------------------------------------------------
const blockerRouter = express.Router();
blockerRouter.use(requireAuth, attachActor);
blockerRouter.post("/:id/resolve", ctrl.resolveBlocker);

// ---------------------------------------------------------------------------
// Task-scoped: POST /api/tasks/:taskId/start  and  /api/tasks/:taskId/blockers
// Mounted onto the existing /api/tasks namespace without touching tasks.js.
// ---------------------------------------------------------------------------
const taskRouter = express.Router({ mergeParams: true });
taskRouter.use(requireAuth, attachActor);
taskRouter.post("/:taskId/start", ctrl.startSession);
taskRouter.post("/:taskId/blockers", ctrl.addBlocker);

module.exports = { dashboardRouter, sessionRouter, blockerRouter, taskRouter };
