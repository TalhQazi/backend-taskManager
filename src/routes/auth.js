const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { z } = require("zod");

const User = require("../models/User");
const { requireAuth } = require("../middleware/auth");
const { logLoginSuccess, logLoginFailure } = require("../middleware/auditLog");
const ActivityLog = require("../models/ActivityLog");

const router = express.Router();

const loginSchema = z
  .object({
    username: z.string().optional(),
    email: z.string().optional(),
    password: z.string().min(1),
  })
  .refine((v) => typeof v.username === "string" || typeof v.email === "string", {
    message: "Username or email is required",
  });

router.post("/login", async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload" } });
    }

    const identifier = String(parsed.data.username || parsed.data.email || "").trim();
    const password = parsed.data.password;
    if (!identifier) {
      return res.status(400).json({ error: { message: "Invalid payload" } });
    }

    const user = await User.findOne({
      $or: [{ username: identifier }, { email: identifier }],
    }).lean();
    if (!user) {
      // Log failed login - user not found
      await logLoginFailure(identifier, req, "User not found");
      return res.status(401).json({ error: { message: "Invalid credentials" } });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      // Log failed login - wrong password
      await logLoginFailure(user.username, req, "Invalid password");
      return res.status(401).json({ error: { message: "Invalid credentials" } });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return res.status(500).json({ error: { message: "JWT_SECRET is not set" } });
    }

    const token = jwt.sign(
      {
        sub: String(user._id),
        role: user.role,
        username: user.username,
        name: user.name || user.username,
      },
      secret,
      { expiresIn: "7d" }
    );

    // Log successful login
    await logLoginSuccess(user, req);

    return res.json({
      item: {
        token,
        role: user.role,
        username: user.username,
      },
    });
  } catch (err) {
    return next(err);
  }
});

// Employee-specific login endpoint
router.post("/employee-login", async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload" } });
    }

    const identifier = String(parsed.data.username || parsed.data.email || "").trim();
    const password = parsed.data.password;
    if (!identifier) {
      return res.status(400).json({ error: { message: "Invalid payload" } });
    }

    const user = await User.findOne({
      $or: [{ username: identifier }, { email: identifier }],
    }).lean();
    if (!user) {
      await logLoginFailure(identifier, req, "User not found");
      return res.status(401).json({ error: { message: "Invalid credentials" } });
    }

    // Check if user is an employee
    if (user.role !== "employee") {
      await logLoginFailure(user.username, req, "Not an employee account");
      return res.status(403).json({ error: { message: "This account is not authorized for employee portal. Please use admin/manager login." } });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      await logLoginFailure(user.username, req, "Invalid password");
      return res.status(401).json({ error: { message: "Invalid credentials" } });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return res.status(500).json({ error: { message: "JWT_SECRET is not set" } });
    }

    const token = jwt.sign(
      {
        sub: String(user._id),
        role: user.role,
        username: user.username,
        name: user.name || user.username,
      },
      secret,
      { expiresIn: "7d" }
    );

    await logLoginSuccess(user, req);

    return res.json({
      item: {
        token,
        role: user.role,
        username: user.username,
        name: user.name || user.username,
      },
    });
  } catch (err) {
    return next(err);
  }
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6),
});

router.put("/change-password", requireAuth, async (req, res, next) => {
  try {
    const userId = String(req.user?.sub || "");
    if (!userId) {
      return res.status(401).json({ error: { message: "Unauthorized" } });
    }

    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload" } });
    }

    const user = await User.findById(userId).lean();
    if (!user) {
      return res.status(404).json({ error: { message: "User not found" } });
    }

    const ok = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash);
    if (!ok) {
      return res.status(400).json({ error: { message: "Current password is incorrect" } });
    }

    const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
    await User.findByIdAndUpdate(userId, { passwordHash });

    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const userId = String(req.user?.sub || "");
    if (!userId) {
      return res.status(401).json({ error: { message: "Unauthorized" } });
    }

    const user = await User.findById(userId).lean();
    if (!user) {
      return res.status(404).json({ error: { message: "User not found" } });
    }

    return res.json({
      item: {
        id: String(user._id),
        name: user.name || "",
        email: user.email || "",
        username: user.username,
        role: user.role,
        status: user.status || "",
      },
    });
  } catch (err) {
    return next(err);
  }
});

// Logout endpoint - logs the logout activity
router.post("/logout", requireAuth, async (req, res, next) => {
  try {
    const userId = String(req.user?.sub || "");
    const username = String(req.user?.username || "unknown");
    const role = String(req.user?.role || "unknown");

    // Log the logout activity
    await ActivityLog.create({
      actorUserId: userId,
      actorUsername: username,
      actorRole: role,
      action: "AUTH_LOGOUT",
      resourceType: "auth",
      resourceId: userId,
      resourceName: username,
      description: `${username} logged out`,
      ipAddress: String(req.ip || req.headers["x-forwarded-for"] || ""),
      userAgent: String(req.headers["user-agent"] || ""),
      metadata: { logoutTime: new Date().toISOString() },
    });

    return res.json({ ok: true, message: "Logged out successfully" });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
