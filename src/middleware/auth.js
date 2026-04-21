const jwt = require("jsonwebtoken");

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

module.exports = { requireAuth, requireRole };
