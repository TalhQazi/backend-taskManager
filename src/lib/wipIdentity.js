/**
 * Canonical actor resolution for the WIP module.
 *
 * The app has exactly one login path (routes/auth.js) and it authenticates
 * against the Employee collection, signing `sub = Employee._id`. So the JWT
 * subject *is* the employeeId — no User<->Employee join is needed.
 *
 * Everything downstream (ownership checks, department scoping, audit actors)
 * must go through resolveActor(). Never match employees by display name:
 * Task.assignees stores free-text names and cannot secure anything.
 */

const mongoose = require("mongoose");
const Employee = require("../models/Employee");
const { OWNER_ROLES, MANAGER_ROLES } = require("../constants/wip");

/** In-process cache of employee department/name. Short TTL; presence changes rarely. */
const cache = new Map();
const CACHE_TTL_MS = 60_000;

function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
}

function isOwner(role) {
  return OWNER_ROLES.includes(normalizeRole(role));
}

function isManager(role) {
  return MANAGER_ROLES.includes(normalizeRole(role));
}

/** Managers and owners may view the dashboard; employees see only themselves. */
function canViewDashboard(role) {
  return isOwner(role) || isManager(role);
}

function toObjectId(id) {
  if (!id) return null;
  if (id instanceof mongoose.Types.ObjectId) return id;
  const s = String(id);
  return mongoose.Types.ObjectId.isValid(s) ? new mongoose.Types.ObjectId(s) : null;
}

async function loadEmployee(employeeId) {
  const key = String(employeeId);
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  const oid = toObjectId(employeeId);
  if (!oid) return null;

  const emp = await Employee.findById(oid).select("name email department userRole status").lean();
  cache.set(key, { value: emp, expires: Date.now() + CACHE_TTL_MS });
  return emp;
}

/** Drop a cached employee (call after department/role changes). */
function invalidateEmployee(employeeId) {
  cache.delete(String(employeeId));
}

/**
 * Build the actor for this request.
 * @returns {Promise<{employeeId: mongoose.Types.ObjectId|null, name: string, email: string,
 *   department: string, role: string, isOwner: boolean, isManager: boolean, canViewDashboard: boolean}>}
 */
async function resolveActor(req) {
  const payload = req?.user || {};
  const employeeId = toObjectId(payload.sub || payload.id || payload._id);
  const role = normalizeRole(payload.role);

  const employee = employeeId ? await loadEmployee(employeeId) : null;

  return {
    employeeId,
    name: employee?.name || payload.name || "",
    email: employee?.email || payload.username || "",
    department: employee?.department || "",
    role,
    isOwner: isOwner(role),
    isManager: isManager(role),
    canViewDashboard: canViewDashboard(role),
  };
}

/**
 * Does `actor` have authority over the employee who owns `session`?
 *
 *   owner            -> every session
 *   manager/lead     -> sessions in their own department
 *   employee         -> only their own session
 */
function canManageSession(actor, session) {
  if (!actor?.employeeId || !session) return false;
  if (actor.isOwner) return true;

  const ownsIt = String(session.employeeId) === String(actor.employeeId);
  if (ownsIt) return true;

  if (actor.isManager) {
    const sameDept =
      !!actor.department &&
      String(session.department || "").toLowerCase() === String(actor.department).toLowerCase();
    return sameDept;
  }
  return false;
}

/** Only managers/owners may read private manager notes. */
function canReadManagerNotes(actor) {
  return !!actor && (actor.isOwner || actor.isManager);
}

/** Manager-only actions: force stop, reassign, request update, override status. */
function canPerformManagerAction(actor, session) {
  if (!actor) return false;
  if (actor.isOwner) return true;
  if (!actor.isManager) return false;
  if (!session) return true;
  return (
    !!actor.department &&
    String(session.department || "").toLowerCase() === String(actor.department).toLowerCase()
  );
}

/**
 * Mongo filter restricting a query to what `actor` is allowed to see.
 * Applied as a $match stage — never post-fetch filtering.
 */
function visibilityFilter(actor) {
  if (!actor?.employeeId) return { _id: null }; // matches nothing
  if (actor.isOwner) return {};
  if (actor.isManager) {
    if (!actor.department) return { employeeId: actor.employeeId };
    return { department: actor.department };
  }
  return { employeeId: actor.employeeId };
}

module.exports = {
  resolveActor,
  canManageSession,
  canPerformManagerAction,
  canReadManagerNotes,
  canViewDashboard,
  visibilityFilter,
  invalidateEmployee,
  toObjectId,
  isOwner,
  isManager,
};
