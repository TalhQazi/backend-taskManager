/**
 * WIP settings: global + per-department overrides, with a short in-process
 * cache so idle sweeps and request handlers don't hammer the collection.
 * Admin changes take effect within `CACHE_TTL_MS` — no deploy required.
 */

const WipDashboardSettings = require("../models/WipDashboardSettings");
const { IDLE_DEFAULTS, DEFAULT_IDLE_EXCLUDED_STATUSES } = require("../constants/wip");

let cached = null;
let cachedAt = 0;
const CACHE_TTL_MS = 60_000;

/** Load (and lazily create) the singleton settings document. */
async function getSettings({ fresh = false } = {}) {
  if (!fresh && cached && Date.now() - cachedAt < CACHE_TTL_MS) return cached;

  let doc = await WipDashboardSettings.findOne({ key: "global" });
  if (!doc) {
    doc = await WipDashboardSettings.create({ key: "global" });
  }
  cached = doc;
  cachedAt = Date.now();
  return doc;
}

function invalidate() {
  cached = null;
  cachedAt = 0;
}

async function updateSettings(actor, patch = {}) {
  const doc = await getSettings({ fresh: true });

  const allowed = ["enabled", "idle", "departments", "gpsEnabled", "gpsRequireConsent", "heartbeatSeconds", "tvMode"];
  for (const key of allowed) {
    if (patch[key] !== undefined) doc.set(key, patch[key]);
  }
  doc.updatedBy = String(actor?.employeeId || "");
  await doc.save();
  invalidate();
  return doc;
}

/**
 * Effective idle configuration for a department.
 * Falls back to global, then to hard defaults.
 */
async function getIdleConfig(department) {
  const doc = await getSettings();
  const resolved = doc.forDepartment(department);
  const idle = resolved.idle || {};
  return {
    moduleEnabled: resolved.enabled !== false,
    enabled: idle.enabled !== undefined ? idle.enabled : IDLE_DEFAULTS.enabled,
    softWarningMinutes: idle.softWarningMinutes ?? IDLE_DEFAULTS.softWarningMinutes,
    reminderMinutes: idle.reminderMinutes ?? IDLE_DEFAULTS.reminderMinutes,
    promptMinutes: idle.promptMinutes ?? IDLE_DEFAULTS.promptMinutes,
    managerAlertMinutes: idle.managerAlertMinutes ?? IDLE_DEFAULTS.managerAlertMinutes,
    excludedStatuses: idle.excludedStatuses?.length ? idle.excludedStatuses : [...DEFAULT_IDLE_EXCLUDED_STATUSES],
  };
}

module.exports = { getSettings, updateSettings, getIdleConfig, invalidate };
