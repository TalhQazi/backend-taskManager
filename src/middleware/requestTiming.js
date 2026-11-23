/**
 * Request timing + slow-endpoint logging.
 *
 * Emits one line per request that exceeds SLOW_REQUEST_MS (default 500ms) and
 * keeps a rolling in-process summary per route, exposed via `getTimingStats()`
 * so /api/health can surface the current worst offenders without an external
 * APM. Deliberately allocation-light: no per-request objects beyond the entry
 * in the stats map, which is keyed by route template (not by URL) so
 * high-cardinality ids never blow up memory.
 */

const SLOW_REQUEST_MS = Number(process.env.SLOW_REQUEST_MS || 300);

// routeKey -> { count, totalMs, maxMs, slowCount }
const stats = new Map();

function routeKeyFor(req) {
  // req.route is only populated once a handler matched; fall back to the mount
  // path so unmatched/404 traffic still aggregates under something stable.
  const base = req.baseUrl || "";
  const routePath = req.route?.path || "";
  const key = `${req.method} ${base}${routePath}`.trim();
  return key === req.method ? `${req.method} ${req.path}` : key;
}

function record(key, ms, isSlow) {
  let entry = stats.get(key);
  if (!entry) {
    entry = { count: 0, totalMs: 0, maxMs: 0, slowCount: 0 };
    stats.set(key, entry);
  }
  entry.count += 1;
  entry.totalMs += ms;
  if (ms > entry.maxMs) entry.maxMs = ms;
  if (isSlow) entry.slowCount += 1;
}

function requestTiming(req, res, next) {
  const startedAt = process.hrtime.bigint();

  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const isSlow = ms >= SLOW_REQUEST_MS;
    const key = routeKeyFor(req);

    record(key, ms, isSlow);

    // Expose the timing to the client/proxy for end-to-end correlation.
    // (Safe: Server-Timing is advisory and ignored by anything that doesn't use it.)
    if (isSlow) {
      console.warn(
        `[SLOW ${ms.toFixed(0)}ms] ${req.method} ${req.originalUrl} → ${res.statusCode}`
      );
    }
  });

  next();
}

/**
 * Snapshot of per-route timings, sorted slowest-average first.
 * @param {number} limit
 */
function getTimingStats(limit = 25) {
  const rows = [];
  for (const [route, e] of stats.entries()) {
    rows.push({
      route,
      count: e.count,
      avgMs: Number((e.totalMs / e.count).toFixed(1)),
      maxMs: Number(e.maxMs.toFixed(1)),
      slowCount: e.slowCount,
    });
  }
  rows.sort((a, b) => b.avgMs - a.avgMs);
  return rows.slice(0, limit);
}

function resetTimingStats() {
  stats.clear();
}

module.exports = { requestTiming, getTimingStats, resetTimingStats, SLOW_REQUEST_MS };
