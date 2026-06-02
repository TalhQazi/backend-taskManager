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

/**
 * ClearHire® Hard Gate Middleware
 * ───────────────────────────────
 * Blocks access for users whose ClearHire status is not GREEN.
 * 
 * Exemptions:
 *   - super-admin, admin: they manage the ClearHire system itself
 *   - Routes can opt out by not using this middleware
 *
 * Status behavior:
 *   GREEN   → pass through
 *   YELLOW  → 403 "Awaiting admin review"
 *   RED     → 403 "Background check failed"
 *   PENDING → 403 "Background check in progress"
 *   No profile → 403 "Background check not completed"
 */
function requireClearHire(req, res, next) {
  const proceed = () => {
    // Exempt admin roles — they manage the system
    const role = req.user?.role;
    if (["super-admin", "admin"].includes(role)) {
      return next();
    }

    const userId = req.user?.sub || req.user?.id || req.user?._id;
    if (!userId) {
      return res.status(401).json({ error: { message: "Unauthorized" } });
    }

    ClearHireProfile.findOne({ userId })
      .select("status")
      .lean()
      .then((profile) => {
        if (!profile) {
          return res.status(403).json({
            error: {
              message: "Background check not completed. Please contact your administrator.",
              code: "CLEARHIRE_NOT_FOUND",
            },
          });
        }

        if (profile.status === "GREEN") {
          return next();
        }

        const messages = {
          PENDING: "Background check is in progress. Please wait.",
          YELLOW: "Your account is under review. Awaiting admin approval.",
          RED: "Access denied. Background check failed.",
        };

        return res.status(403).json({
          error: {
            message: messages[profile.status] || "Access denied.",
            code: `CLEARHIRE_${profile.status}`,
            clearHireStatus: profile.status,
          },
        });
      })
      .catch((err) => {
        console.error("[ClearHire Middleware] Error:", err.message);
        // Fail open for DB errors — don't lock everyone out if DB hiccups
        return next();
      });
  };

  if (!req.user) {
    return requireAuth(req, res, proceed);
  }
  return proceed();
}

module.exports = { requireAuth, requireRole, requireClearHire };

