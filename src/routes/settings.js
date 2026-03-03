const express = require("express");
const { z } = require("zod");
const multer = require("multer");
const path = require("path");

const Settings = require("../models/Settings");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// Configure multer for avatar uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.resolve(__dirname, "..", "..", "uploads"));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, "avatar-" + uniqueSuffix + ext);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error("Only image files are allowed"));
  },
});

const settingsSchema = z.object({
  companyName: z.string().optional(),
  supportEmail: z.string().optional(),
  notificationsEnabled: z.boolean().optional(),
  autoLogoutMinutes: z.number().optional(),
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

// Avatar upload endpoint
router.post("/avatar", requireAuth, upload.single("avatar"), async (req, res, next) => {
  try {
    const userId = String(req.user?.sub || "");
    if (!userId) return res.status(401).json({ error: { message: "Unauthorized" } });

    if (!req.file) {
      return res.status(400).json({ error: { message: "No file uploaded" } });
    }

    const avatarUrl = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;

    const updated = await Settings.findOneAndUpdate(
      { userId },
      { $set: { avatarUrl } },
      { new: true, upsert: true }
    ).lean();

    res.json({ item: updated, avatarUrl });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
