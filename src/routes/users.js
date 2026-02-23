const express = require("express");
const bcrypt = require("bcryptjs");
const { z } = require("zod");

const User = require("../models/User");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

function sanitizeUser(u) {
  if (!u) return u;
  const { passwordHash, ...rest } = u;
  return rest;
}

const createSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(6),
  role: z.enum(["admin", "manager"]),
});

const updateSchema = z
  .object({
    username: z.string().min(1).optional(),
    password: z.string().min(6).optional(),
    role: z.enum(["admin", "manager"]).optional(),
  })
  .partial();

router.get("/", requireAuth, requireRole(["admin"]), async (_req, res, next) => {
  try {
    const items = await User.find().sort({ createdAt: -1 }).lean();
    res.json({ items: items.map(sanitizeUser) });
  } catch (err) {
    next(err);
  }
});

router.post("/", requireAuth, requireRole(["admin"]), async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload" } });
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 10);
    const created = await User.create({
      username: parsed.data.username,
      passwordHash,
      role: parsed.data.role,
    });

    res.status(201).json({ item: sanitizeUser(created.toObject()) });
  } catch (err) {
    
    if (err && err.code === 11000) {
      return res.status(409).json({ error: { message: "Username already exists" } });
    }
    return next(err);
  }
});

router.put("/:id", requireAuth, requireRole(["admin"]), async (req, res, next) => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload" } });
    }

    const patch = { ...parsed.data };
    if (typeof patch.password === "string" && patch.password) {
      patch.passwordHash = await bcrypt.hash(patch.password, 10);
      delete patch.password;
    }

    const updated = await User.findByIdAndUpdate(req.params.id, patch, { new: true }).lean();
    if (!updated) {
      return res.status(404).json({ error: { message: "User not found" } });
    }

    return res.json({ item: sanitizeUser(updated) });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ error: { message: "Username already exists" } });
    }
    return next(err);
  }
});

router.delete("/:id", requireAuth, requireRole(["admin"]), async (req, res, next) => {
  try {
    const deleted = await User.findByIdAndDelete(req.params.id).lean();
    if (!deleted) {
      return res.status(404).json({ error: { message: "User not found" } });
    }
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
