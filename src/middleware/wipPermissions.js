/**
 * WIP authorization middleware.
 *
 * Attaches `req.actor` (see lib/wipIdentity) and enforces coarse gates. Fine-
 * grained per-session checks live in the service layer, where the session doc
 * is already loaded — doing it here would mean a second read.
 */

const { resolveActor, canViewDashboard } = require("../lib/wipIdentity");

/** Populate req.actor for every WIP route. Requires requireAuth to have run. */
async function attachActor(req, res, next) {
  try {
    req.actor = await resolveActor(req);
    if (!req.actor.employeeId) {
      return res.status(401).json({ error: { message: "Unable to resolve employee identity" } });
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

/** Managers and owners only — the dashboard, activity feed, reports. */
function requireDashboardAccess(req, res, next) {
  if (!canViewDashboard(req.actor?.role)) {
    return res.status(403).json({ error: { message: "Forbidden: dashboard access requires manager or owner role" } });
  }
  return next();
}

/** Owners only — settings mutation. */
function requireOwner(req, res, next) {
  if (!req.actor?.isOwner) {
    return res.status(403).json({ error: { message: "Forbidden: owner role required" } });
  }
  return next();
}

/** Managers and owners — intervention endpoints. */
function requireManager(req, res, next) {
  if (!req.actor?.isOwner && !req.actor?.isManager) {
    return res.status(403).json({ error: { message: "Forbidden: manager role required" } });
  }
  return next();
}

/**
 * Hard block on every write for read-only surfaces (TV mode).
 * Enforced at the API layer, not by hiding buttons.
 */
function denyWrites(req, res, next) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return res.status(403).json({ error: { message: "This endpoint is read-only" } });
  }
  return next();
}

module.exports = {
  attachActor,
  requireDashboardAccess,
  requireOwner,
  requireManager,
  denyWrites,
};
