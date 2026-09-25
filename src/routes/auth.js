const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { z } = require("zod");

const Employee = require("../models/Employee");
const ClearHireProfile = require("../models/ClearHireProfile");
const { requireAuth } = require("../middleware/auth");
const { logLoginSuccess, logLoginFailure } = require("../middleware/auditLog");
const ActivityLog = require("../models/ActivityLog");
const { sendSystemEmail } = require("../lib/email");

const router = express.Router();

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\$&");
}

async function findEmployee(identifier) {
  return Employee.findOne({
    email: new RegExp(`^${escapeRegex(identifier)}$`, "i"),
  }).lean();
}

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

    const employee = await findEmployee(identifier);

    if (!employee) {
      await logLoginFailure(identifier, req, "User not found");
      return res.status(401).json({ error: { message: "Invalid credentials" } });
    }

    const role = String(employee.userRole || "").trim();

    // Role not configured — instruct to contact admin
    if (!role) {
      return res.json({ roleNotDefined: true });
    }

    // First-login: no password set yet — prompt one-time setup
    if (!employee.passwordHash || employee.passwordHash.trim() === "") {
      return res.json({
        needsPasswordSetup: true,
        identifier: employee.email,
      });
    }

    const ok = await bcrypt.compare(password, employee.passwordHash);
    if (!ok) {
      await logLoginFailure(employee.email, req, "Invalid password");
      return res.status(401).json({ error: { message: "Invalid credentials" } });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return res.status(500).json({ error: { message: "JWT_SECRET is not set" } });
    }

    const token = jwt.sign(
      {
        sub: String(employee._id),
        role,
        username: employee.email,
        name: employee.name,
        source: "employee",
      },
      secret,
      { expiresIn: "7d" }
    );

    await logLoginSuccess({ _id: employee._id, username: employee.email, role, name: employee.name }, req);

    // Fetch ClearHire status for the frontend
    const clearHireProfile = await ClearHireProfile.findOne({ userId: employee._id })
      .select("status riskScore")
      .lean();

    return res.json({
      item: {
        token,
        role,
        username: employee.email,
        name: employee.name,
        clearHireStatus: clearHireProfile?.status || null,
      },
    });
  } catch (err) {
    return next(err);
  }
});

// One-time password setup — only works when passwordHash is empty
router.post("/setup-password", async (req, res, next) => {
  try {
    const { identifier, newPassword } = req.body;
    if (!identifier || !newPassword || String(newPassword).length < 6) {
      return res.status(400).json({ error: { message: "Identifier and password (min 6 characters) are required" } });
    }

    const employee = await findEmployee(identifier);
    if (!employee) {
      return res.status(404).json({ error: { message: "Account not found" } });
    }

    if (employee.passwordHash && employee.passwordHash.trim() !== "") {
      return res.status(403).json({ error: { message: "Password has already been set. Please use the login form." } });
    }

    const passwordHash = await bcrypt.hash(String(newPassword), 10);
    await Employee.findByIdAndUpdate(employee._id, { passwordHash });

    return res.json({ ok: true, message: "Password set successfully. You can now log in." });
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

    const employee = await Employee.findById(userId).lean();
    if (!employee) {
      return res.status(404).json({ error: { message: "User not found" } });
    }

    const ok = await bcrypt.compare(parsed.data.currentPassword, employee.passwordHash || "");
    if (!ok) {
      return res.status(400).json({ error: { message: "Current password is incorrect" } });
    }

    const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
    await Employee.findByIdAndUpdate(userId, { passwordHash });

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

    const employee = await Employee.findById(userId).lean();
    if (!employee) {
      return res.status(404).json({ error: { message: "User not found" } });
    }

    return res.json({
      item: {
        id: String(employee._id),
        name: employee.name || "",
        email: employee.email || "",
        username: employee.email || "",
        role: employee.userRole || "",
        status: employee.userStatus || "active",
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

// Request password reset code
router.post("/forgot-password", async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: { message: "Email is required" } });

    const employee = await findEmployee(email);
    if (!employee) {
      return res.json({ ok: true, message: "If an account exists with this email, a reset code has been sent." });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = new Date(Date.now() + 3600000); // 1 hour

    await Employee.findByIdAndUpdate(employee._id, {
      resetPasswordCode: code,
      resetPasswordExpires: expires,
    });

    await sendSystemEmail({
      to: employee.email,
      templateKey: "forgotPassword",
      variables: { name: employee.name, code },
    });

    return res.json({ ok: true, message: "Reset code sent successfully" });
  } catch (err) {
    next(err);
  }
});

// Reset password with code
router.post("/reset-password", async (req, res, next) => {
  try {
    const { email, code, newPassword } = req.body;
    if (!email || !code || !newPassword) {
      return res.status(400).json({ error: { message: "Email, code and new password are required" } });
    }

    const employee = await Employee.findOne({
      email: new RegExp(`^${escapeRegex(email)}$`, "i"),
      resetPasswordCode: code,
      resetPasswordExpires: { $gt: new Date() },
    });

    if (!employee) {
      return res.status(400).json({ error: { message: "Invalid or expired reset code" } });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await Employee.findByIdAndUpdate(employee._id, {
      passwordHash,
      resetPasswordCode: null,
      resetPasswordExpires: null,
    });

    return res.json({ ok: true, message: "Password reset successfully" });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
