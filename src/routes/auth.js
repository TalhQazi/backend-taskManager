const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { z } = require("zod");

const User = require("../models/User");
const { requireAuth } = require("../middleware/auth");

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
      return res.status(401).json({ error: { message: "Invalid credentials" } });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: { message: "Invalid credentials" } });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return res.status(500).json({ error: { message: "JWT_SECRET is not set" } });
    }

    const token = jwt.sign(
      { sub: String(user._id), role: user.role, username: user.username },
      secret,
      { expiresIn: "7d" }
    );

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

module.exports = router;
