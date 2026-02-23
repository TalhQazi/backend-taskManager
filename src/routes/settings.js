const express = require("express");
const { z } = require("zod");

const Settings = require("../models/Settings");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const settingsSchema = z.object({
  fullName: z.string().optional().default(""),
  email: z.string().optional().default(""),
  phone: z.string().optional().default(""),
  role: z.string().optional().default(""),
  notifications: z
    .object({
      emailNotifications: z.boolean().optional(),
      taskAlerts: z.boolean().optional(),
      employeeUpdates: z.boolean().optional(),
      weeklyReports: z.boolean().optional(),
    })
    .optional(),
  language: z.string().optional(),
  timezone: z.string().optional(),
});

router.get("/", requireAuth, async (req, res, next) => {
  try {
    const userId = String(req.user?.sub || "");
    if (!userId) return res.status(401).json({ error: { message: "Unauthorized" } });

    let doc = await Settings.findOne({ userId }).lean();
    if (!doc) {
      const created = await Settings.create({ userId, role: req.user?.role || "" });
      doc = created.toObject();
    }

    res.json({ item: doc });
  } catch (err) {
    next(err);
  }
});

router.put("/", requireAuth, async (req, res, next) => {
  try {
    const userId = String(req.user?.sub || "");
    if (!userId) return res.status(401).json({ error: { message: "Unauthorized" } });

    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { message: "Invalid payload" } });

    const patch = parsed.data;

    const updated = await Settings.findOneAndUpdate(
      { userId },
      {
        $set: {
          ...patch,
          userId,
        },
      },
      { new: true, upsert: true }
    ).lean();

    res.json({ item: updated });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
