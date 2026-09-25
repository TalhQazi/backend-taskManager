/* Build the KV request context from the authenticated request.
 * organizationId is optional today (token has no org) → features degrade to
 * owner-scoping gracefully. Populate it here if/when the token carries it. */
function kvContext(req) {
  const u = req.user || {};
  return {
    userId: String(u.sub || u.id || u._id || ""),
    role: String(u.role || "").trim().toLowerCase(),
    organizationId: u.organizationId || u.companyId || null,
    ip: req.ip || req.headers["x-forwarded-for"] || "",
    userAgent: req.headers["user-agent"] || "",
    requestId: req.headers["x-request-id"] || "",
  };
}

/** Wrap async handlers so rejections hit Express error middleware. */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Translate a service result sentinel into an HTTP response; return true if handled. */
function handleSentinel(res, result) {
  if (result === null) {
    res.status(404).json({ error: { message: "Not found" } });
    return true;
  }
  if (result && result.forbidden) {
    res.status(403).json({ error: { message: "Forbidden" } });
    return true;
  }
  if (result && result.conflict) {
    res.status(409).json({ error: { message: "Version conflict", currentVersion: result.currentVersion } });
    return true;
  }
  return false;
}

module.exports = { kvContext, wrap, handleSentinel };
