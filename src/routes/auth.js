const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { z } = require("zod");

const User = require("../models/User");

const router = express.Router();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

router.post("/login", async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload" } });
    }

    const { username, password } = parsed.data;

    const user = await User.findOne({ username }).lean();
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

module.exports = router;
