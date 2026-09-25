const jwt = require("jsonwebtoken");
const ClearHireProfile = require("../models/ClearHireProfile");

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  let [type, token] = header.split(" ");

  // Fallback to query parameter 'token' if header is missing or invalid
  if ((type !== "Bearer" || !token) && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: { message: "Unauthorized" } });
  }

  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return res.status(500).json({ error: { message: "JWT_SECRET is not set" } });
    }
    const payload = jwt.verify(token, secret);
    req.user = payload;
    const userId = String((payload && typeof payload === "object" ? payload.sub || payload.id || payload._id : "") || "");
    req.user._id = userId;
    req.user.id = userId;
    return next();
  } catch {
    return res.status(401).json({ error: { message: "Unauthorized" } });
  }
}

function requireRole(roles) {
  return (req, res, next) => {
    const role = req.user?.role;
    if (!role || !roles.includes(role)) {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }
    return next();
  };
}

const CLEARHIRE_MESSAGES = {
  PENDING: "Background check is in progress. Please wait.",
  YELLOW: "Your account is under review. Awaiting admin approval.",
  RED: "Access denied. Background check failed.",
};

/**
 * Resolve the gate decision with one parallel round-trip instead of three
 * sequential ones.
 *
 * This is a pure latency change: the same three lookups run, the same
 * precedence is applied to their results, and the same fail-open-on-error
 * contract holds. No decision is cached — the gate is an authorization check,
 * and a stale allow/deny is not an acceptable trade for a few milliseconds
 * against a Docker-local database.
 *
 * @returns {Promise<{allow: boolean, code?: string, message?: string, clearHireStatus?: string}>}
 */
async function resolveClearHireGate(userId) {
  const Employee = require("../models/Employee");
  const Onboarding = require("../models/Onboarding");

  const [empRes, onbRes, profileRes] = await Promise.allSettled([
    Employee.findById(userId).select("onboardingRequired status").lean(),
    Onboarding.findOne({ userId }).select("overallStatus").lean(),
    ClearHireProfile.findOne({ userId }).select("status").lean(),
  ]);

  // Fail-open on errors so database transient issues never lock users out
  if (empRes.status === "rejected" || onbRes.status === "rejected" || profileRes.status === "rejected") {
    return { allow: true };
  }

  const emp = empRes.value;
  if (emp && (emp.onboardingRequired === false || emp.status === "active")) {
    return { allow: true };
  }

  const onb = onbRes.value;
  if (onb && onb.overallStatus === "approved") {
    return { allow: true };
  }

  const profile = profileRes.value;
  if (!profile) {
    // If no background check is registered and employee is not blocked, allow access
    return { allow: true };
  }

  if (profile.status === "GREEN") {
    return { allow: true };
  }

  if (profile.status === "RED") {
    return {
      allow: false,
      code: "CLEARHIRE_RED",
      clearHireStatus: "RED",
      message: CLEARHIRE_MESSAGES.RED || "Access denied.",
    };
  }

  return { allow: true };
}

/**
 * ClearHire® Hard Gate Middleware
 */
function requireClearHire(req, res, next) {
  const proceed = async () => {
    // Exempt super-admin, admin, manager, team-lead, coder roles
    const role = String(req.user?.role || "").toLowerCase().trim();
    if (["super-admin", "admin", "manager", "team-lead", "coder"].includes(role)) {
      return next();
    }

    const userId = req.user?.sub || req.user?.id || req.user?._id;
    if (!userId) {
      return res.status(401).json({ error: { message: "Unauthorized" } });
    }

    const decision = await resolveClearHireGate(userId);

    if (decision.allow) {
      return next();
    }

    const error = { message: decision.message, code: decision.code };
    if (decision.clearHireStatus) error.clearHireStatus = decision.clearHireStatus;
    return res.status(403).json({ error });
  };

  const run = () => {
    proceed().catch((err) => {
      // Belt-and-braces: preserve the fail-open contract even on unexpected throws.
      console.error("[ClearHire Middleware] Unexpected error:", err?.message);
      return next();
    });
  };

  if (!req.user) {
    return requireAuth(req, res, run);
  }
  return run();
}

module.exports = { requireAuth, requireRole, requireClearHire };
