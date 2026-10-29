/**
 * Elapsed-time math. Pure functions, no DB, no Date.now() hidden inside.
 *
 * This is the single definition of "how long has this been worked on", shared
 * conceptually with the frontend ElapsedTimer (which reimplements the same
 * formula locally so it can tick every second without touching the network).
 *
 * Model:
 *   elapsed = (endedAt ?? now) - startedAt - pausedTotalSeconds - currentPause
 *
 * `pausedTotalSeconds` accumulates completed pauses. `pausedAt` marks an open
 * pause whose duration must be subtracted on the fly until it is closed.
 */

/** @typedef {{startedAt: Date, endedAt?: Date|null, pausedAt?: Date|null, pausedTotalSeconds?: number}} SessionLike */

const toMs = (d) => (d instanceof Date ? d.getTime() : d ? new Date(d).getTime() : null);

/**
 * Seconds of the currently-open pause, or 0 when the clock is running.
 * @param {SessionLike} session
 * @param {Date} now
 */
function openPauseSeconds(session, now = new Date()) {
  const pausedAt = toMs(session.pausedAt);
  if (!pausedAt) return 0;
  // If the session ended while paused, the pause stops at endedAt.
  const boundary = toMs(session.endedAt) ?? toMs(now);
  if (boundary == null || boundary <= pausedAt) return 0;
  return Math.floor((boundary - pausedAt) / 1000);
}

/**
 * Total productive seconds for a session.
 * @param {SessionLike} session
 * @param {Date} now
 * @returns {number} non-negative integer seconds
 */
function computeElapsedSeconds(session, now = new Date()) {
  if (!session) return 0;
  const startedAt = toMs(session.startedAt);
  if (startedAt == null) return 0;

  const end = toMs(session.endedAt) ?? toMs(now);
  if (end == null || end <= startedAt) return 0;

  const grossSeconds = Math.floor((end - startedAt) / 1000);
  const paused = Math.max(0, Number(session.pausedTotalSeconds) || 0) + openPauseSeconds(session, now);

  return Math.max(0, grossSeconds - paused);
}

/**
 * Close an open pause: how many seconds to fold into pausedTotalSeconds.
 * Returns the new pausedTotalSeconds. Does not mutate.
 * @param {SessionLike} session
 * @param {Date} now
 */
function settlePause(session, now = new Date()) {
  const base = Math.max(0, Number(session.pausedTotalSeconds) || 0);
  return base + openPauseSeconds(session, now);
}

/**
 * Labor cost in integer cents. Rate is cents-per-hour, snapshotted at start.
 * Returns 0 when no rate was captured (never guesses a rate).
 * @param {number} elapsedSeconds
 * @param {number|null} rateCentsPerHour
 */
function computeLaborCostCents(elapsedSeconds, rateCentsPerHour) {
  const rate = Number(rateCentsPerHour);
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  const seconds = Math.max(0, Number(elapsedSeconds) || 0);
  return Math.round((seconds / 3600) * rate);
}

/**
 * Estimated finish time from progress velocity.
 * Returns null when progress is 0 or complete — a forecast needs signal, and
 * we never present false precision.
 * @param {SessionLike & {progressPercent?: number}} session
 * @param {Date} now
 * @returns {Date|null}
 */
function estimateFinishAt(session, now = new Date()) {
  const progress = Number(session?.progressPercent) || 0;
  if (progress <= 0 || progress >= 100) return null;

  const elapsed = computeElapsedSeconds(session, now);
  if (elapsed <= 0) return null;

  const totalEstimatedSeconds = elapsed / (progress / 100);
  const remainingSeconds = Math.max(0, totalEstimatedSeconds - elapsed);
  return new Date(toMs(now) + remainingSeconds * 1000);
}

/**
 * Seconds since the last recorded activity signal.
 * @param {{lastActivityAt?: Date|null}} session
 * @param {Date} now
 */
function idleSeconds(session, now = new Date()) {
  const last = toMs(session?.lastActivityAt);
  if (last == null) return 0;
  return Math.max(0, Math.floor((toMs(now) - last) / 1000));
}

module.exports = {
  computeElapsedSeconds,
  openPauseSeconds,
  settlePause,
  computeLaborCostCents,
  estimateFinishAt,
  idleSeconds,
};
