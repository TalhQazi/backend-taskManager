const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { authenticator } = require("otplib");
const qrcode = require("qrcode");
const { z } = require("zod");

const User = require("../models/User");
const RefreshToken = require("../models/RefreshToken");
const { requireAuth } = require("../middleware/auth");
const { logLoginSuccess, logLoginFailure } = require("../middleware/auditLog");
const ActivityLog = require("../models/ActivityLog");

const router = express.Router();

const isDev = String(process.env.NODE_ENV || "").toLowerCase() !== "production";
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: !isDev,
  sameSite: "lax",
};

async function generateTokens(user, req, res) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");

  // Short-lived access token (15 minutes)
  const accessToken = jwt.sign(
    {
      sub: String(user._id),
      role: user.role,
      username: user.username,
      name: user.name || user.username,
    },
    secret,
    { expiresIn: "15m" }
  );

  // Secure refresh token (7 days)
  const refreshTokenString = crypto.randomBytes(40).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await RefreshToken.create({
    userId: user._id,
    token: refreshTokenString,
    expiresAt,
    ipAddress: String(req.ip || req.headers["x-forwarded-for"] || ""),
    userAgent: String(req.headers["user-agent"] || ""),
  });

  // Set cookies
  res.cookie("accessToken", accessToken, { ...COOKIE_OPTIONS, maxAge: 15 * 60 * 1000 });
  res.cookie("refreshToken", refreshTokenString, { ...COOKIE_OPTIONS, maxAge: 7 * 24 * 60 * 60 * 1000 });

  return accessToken;
}

const loginSchema = z
  .object({
    username: z.string().optional(),
    email: z.string().optional(),
    password: z.string().min(1),
    mfaCode: z.string().optional(),
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
    const { password, mfaCode } = parsed.data;
    
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

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      await logLoginFailure(user.username, req, "Invalid password");
      return res.status(401).json({ error: { message: "Invalid credentials" } });
    }

    // MFA Check
    if (user.mfaEnabled) {
      if (!mfaCode) {
        return res.status(403).json({ error: { message: "MFA code required", code: "MFA_REQUIRED" } });
      }
      const isValidMfa = authenticator.verify({ token: mfaCode, secret: user.mfaSecret });
      if (!isValidMfa) {
        await logLoginFailure(user.username, req, "Invalid MFA code");
        return res.status(401).json({ error: { message: "Invalid MFA code" } });
      }
    }

    const token = await generateTokens(user, req, res);
    await logLoginSuccess(user, req);

    return res.json({
      item: {
        token, // still return for backward compatibility during transition
        role: user.role,
        username: user.username,
      },
    });
  } catch (err) {
    return next(err);
  }
});

router.post("/employee-login", async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload" } });
    }

    const identifier = String(parsed.data.username || parsed.data.email || "").trim();
    const { password, mfaCode } = parsed.data;
    
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

    if (user.role !== "employee") {
      await logLoginFailure(user.username, req, "Not an employee account");
      return res.status(403).json({ error: { message: "This account is not authorized for employee portal." } });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      await logLoginFailure(user.username, req, "Invalid password");
      return res.status(401).json({ error: { message: "Invalid credentials" } });
    }

    // MFA Check (Even for employees if enabled)
    if (user.mfaEnabled) {
      if (!mfaCode) {
        return res.status(403).json({ error: { message: "MFA code required", code: "MFA_REQUIRED" } });
      }
      const isValidMfa = authenticator.verify({ token: mfaCode, secret: user.mfaSecret });
      if (!isValidMfa) {
        await logLoginFailure(user.username, req, "Invalid MFA code");
        return res.status(401).json({ error: { message: "Invalid MFA code" } });
      }
    }

    const token = await generateTokens(user, req, res);
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

router.post("/refresh", async (req, res, next) => {
  try {
    const refreshTokenString = req.cookies?.refreshToken;
    if (!refreshTokenString) {
      return res.status(401).json({ error: { message: "No refresh token provided" } });
    }

    const tokenDoc = await RefreshToken.findOne({ token: refreshTokenString }).populate("userId");
    if (!tokenDoc || tokenDoc.revoked || tokenDoc.expiresAt < new Date()) {
      res.clearCookie("accessToken", COOKIE_OPTIONS);
      res.clearCookie("refreshToken", COOKIE_OPTIONS);
      return res.status(401).json({ error: { message: "Invalid or expired refresh token" } });
    }

    const user = tokenDoc.userId;
    if (!user || user.status !== "active") {
      return res.status(401).json({ error: { message: "User account inactive" } });
    }

    // Revoke old token and generate new ones (Rotation)
    tokenDoc.revoked = true;
    await tokenDoc.save();

    const token = await generateTokens(user, req, res);

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

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6),
});

router.put("/change-password", requireAuth, async (req, res, next) => {
  try {
    const userId = String(req.user?.sub || "");
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { message: "Invalid payload" } });

    const user = await User.findById(userId).lean();
    if (!user) return res.status(404).json({ error: { message: "User not found" } });

    const ok = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash);
    if (!ok) return res.status(400).json({ error: { message: "Current password is incorrect" } });

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
    const user = await User.findById(userId).lean();
    if (!user) return res.status(404).json({ error: { message: "User not found" } });

    return res.json({
      item: {
        id: String(user._id),
        name: user.name || "",
        email: user.email || "",
        username: user.username,
        role: user.role,
        status: user.status || "",
        mfaEnabled: user.mfaEnabled || false,
      },
    });
  } catch (err) {
    return next(err);
  }
});

router.post("/logout", requireAuth, async (req, res, next) => {
  try {
    const userId = String(req.user?.sub || "");
    const username = String(req.user?.username || "unknown");
    const role = String(req.user?.role || "unknown");
    
    // Revoke refresh token
    const refreshTokenString = req.cookies?.refreshToken;
    if (refreshTokenString) {
      await RefreshToken.updateOne({ token: refreshTokenString }, { revoked: true });
    }

    res.clearCookie("accessToken", COOKIE_OPTIONS);
    res.clearCookie("refreshToken", COOKIE_OPTIONS);

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

// --- MFA ENDPOINTS ---

router.post("/mfa/setup", requireAuth, async (req, res, next) => {
  try {
    const userId = String(req.user?.sub || "");
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: { message: "User not found" } });

    if (user.mfaEnabled) {
      return res.status(400).json({ error: { message: "MFA is already enabled" } });
    }

    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(user.username, "Se7en Task Manager", secret);
    const qrCodeImage = await qrcode.toDataURL(otpauthUrl);

    // Temporarily save the secret. It will be officially enabled in /mfa/verify
    user.mfaSecret = secret;
    await user.save();

    return res.json({
      item: {
        secret,
        qrCodeImage,
      },
    });
  } catch (err) {
    return next(err);
  }
});

router.post("/mfa/verify", requireAuth, async (req, res, next) => {
  try {
    const userId = String(req.user?.sub || "");
    const { token } = req.body;

    if (!token) return res.status(400).json({ error: { message: "MFA token required" } });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: { message: "User not found" } });

    const isValid = authenticator.verify({ token, secret: user.mfaSecret });
    if (!isValid) {
      return res.status(400).json({ error: { message: "Invalid MFA code" } });
    }

    user.mfaEnabled = true;
    await user.save();

    return res.json({ ok: true, message: "MFA successfully enabled" });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
