const express = require("express");
const { z } = require("zod");
const multer = require("multer");

const Settings = require("../models/Settings");
const { requireAuth } = require("../middleware/auth");
const { uploadToS3, base64ToBuffer } = require("../lib/s3");

const router = express.Router();

// Configure multer for memory storage (for serverless environments like Vercel)
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit (fits in MongoDB 16MB after base64 ~13MB)
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(file.originalname.toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error("Only image files are allowed"));
  },
});

const preferenceSchema = z.object({
  taskAssignment: z.boolean().optional(),
  projectAssignment: z.boolean().optional(),
  commentAdded: z.boolean().optional(),
  replyAdded: z.boolean().optional(),
  taskCompleted: z.boolean().optional(),
  eodMissAlert: z.boolean().optional(),
  eodComment: z.boolean().optional(),
  messageAlert: z.boolean().optional(),
  systemAlert: z.boolean().optional(),
  patentExpiration: z.boolean().optional(),
  complianceReminder: z.boolean().optional(),
  userRegistration: z.boolean().optional(),
  lunchBreakAlert: z.boolean().optional(),
  websiteDownAlert: z.boolean().optional(),
}).optional();

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
  emailPreferences: preferenceSchema,
  webPreferences: preferenceSchema,
  language: z.string().optional(),
  timezone: z.string().optional(),
  countryCode: z.string().optional(),
  avatarUrl: z.string().optional(),
  avatarDataUrl: z.string().optional(),
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

    const patch = { ...parsed.data };

    // If avatarDataUrl is sent as base64 in the body, upload to S3
    if (patch.avatarDataUrl && patch.avatarDataUrl.startsWith("data:")) {
      try {
        const { buffer, mimeType } = base64ToBuffer(patch.avatarDataUrl);
        const s3Url = await uploadToS3(buffer, `avatar-${userId}`, mimeType, "avatars");
        patch.avatarDataUrl = s3Url;
        patch.avatarUrl = s3Url;
      } catch (err) {
        console.error("Failed to upload avatar from base64 to S3:", err);
      }
    }

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

    // Sync to Employee record as well
    const Employee = require("../models/Employee");
    const employeeUpdate = {};
    if (patch.fullName) {
      employeeUpdate.name = patch.fullName;
      employeeUpdate.initials = patch.fullName
        .split(" ")
        .map((n) => n[0])
        .slice(0, 2)
        .join("")
        .toUpperCase();
    }
    if (patch.email) employeeUpdate.email = patch.email;
    if (patch.phone) employeeUpdate.phone = patch.phone;
    if (Object.keys(employeeUpdate).length > 0) {
      await Employee.findByIdAndUpdate(userId, employeeUpdate);
    }

    res.json({ item: updated });
  } catch (err) {
    next(err);
  }
});

// Avatar upload endpoint - stores as base64 data URL in MongoDB
router.post("/avatar", requireAuth, upload.single("avatar"), async (req, res, next) => {
  try {
    const userId = String(req.user?.sub || "");
    if (!userId) return res.status(401).json({ error: { message: "Unauthorized" } });

    if (!req.file) {
      return res.status(400).json({ error: { message: "No file uploaded" } });
    }

    // Upload file buffer to S3
    let avatarUrl = "";
    try {
      avatarUrl = await uploadToS3(req.file.buffer, req.file.originalname, req.file.mimetype, "avatars");
    } catch (err) {
      console.error("Failed to upload avatar to S3:", err);
      // Fallback to base64 if S3 fails
      const base64 = req.file.buffer.toString("base64");
      avatarUrl = `data:${req.file.mimetype};base64,${base64}`;
    }

    const updated = await Settings.findOneAndUpdate(
      { userId },
      { $set: { avatarUrl: avatarUrl, avatarDataUrl: avatarUrl } },
      { new: true, upsert: true }
    ).lean();

    res.json({ item: updated, avatarUrl, avatarDataUrl: avatarUrl });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
