const express = require("express");
const router = express.Router();
const HolidayTheme = require("../models/HolidayTheme");
const UserThemePreferences = require("../models/UserThemePreferences");
const OrgThemeSettings = require("../models/OrgThemeSettings");
const ThemeAuditLog = require("../models/ThemeAuditLog");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const {
  resolveActiveTheme,
  seedDefaultHolidayThemes,
  getAllSchedules,
  upsertSchedule,
  deleteSchedule,
  getOrgSettings,
  updateOrgSettings,
  getAuditLogs,
  upsertTheme,
  uploadThemeAsset,
  getThemeAssets,
  deleteThemeAsset,
} = require("../services/themeEngineService");
const jwt = require("jsonwebtoken");

const themeAssetsDir = path.resolve(__dirname, "../../uploads/theme-assets");
try {
  fs.mkdirSync(themeAssetsDir, { recursive: true });
} catch (e) {}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, themeAssetsDir);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, `theme-asset-${uniqueSuffix}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB limit
  fileFilter: (_req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|avif|svg/;
    const ext = path.extname(file.originalname).toLowerCase();
    const mime = file.mimetype.toLowerCase();
    if (allowed.test(ext) || allowed.test(mime)) {
      cb(null, true);
    } else {
      cb(new Error("Only images (webp, avif, png, svg, jpeg) are allowed"));
    }
  },
});

/**
 * Middleware to optionally extract user/org info from JWT if present,
 * without strictly rejecting anonymous or unauthenticated requests.
 */
function optionalAuth(req, _res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];
      const decoded = jwt.decode(token);
      if (decoded) {
        req.authContext = {
          userId: decoded.id || decoded._id || decoded.username,
          orgId: decoded.orgId || "default",
          role: decoded.role,
        };
      }
    }
  } catch (err) {
    // Ignore invalid tokens for optional extraction
  }
  next();
}

/**
 * GET /api/themes/active
 * Deterministic active theme resolution endpoint.
 * Query params: orgId, userId, reducedMotion, date
 */
router.get("/active", optionalAuth, async (req, res) => {
  try {
    const orgId = String(req.query.orgId || req.authContext?.orgId || "default");
    const userId = req.query.userId ? String(req.query.userId) : req.authContext?.userId || null;
    const systemReducedMotion = req.query.reducedMotion === "true" || req.query.reducedMotion === "1";
    const clientDate = req.query.date ? new Date(req.query.date) : new Date();

    const resolution = await resolveActiveTheme({
      orgId,
      userId,
      systemReducedMotion,
      clientDate,
    });

    return res.status(200).json({
      ok: true,
      data: resolution,
    });
  } catch (err) {
    console.error("[ThemeEngine] Error resolving active theme:", err);
    return res.status(500).json({
      ok: false,
      error: { message: err.message || "Failed to resolve active theme" },
    });
  }
});

/**
 * GET /api/themes/list
 * Returns list of all available themes for user selection or admin catalogs.
 */
router.get("/list", async (_req, res) => {
  try {
    const themes = await HolidayTheme.find({ isActive: true })
      .select("themeKey displayName description category priority palette layout animations")
      .sort({ priority: -1 })
      .lean();

    return res.status(200).json({
      ok: true,
      themes,
    });
  } catch (err) {
    console.error("[ThemeEngine] Error fetching theme list:", err);
    return res.status(500).json({
      ok: false,
      error: { message: "Failed to fetch theme list" },
    });
  }
});

/**
 * GET /api/themes/preference
 * Returns user theme preferences.
 */
router.get("/preference", optionalAuth, async (req, res) => {
  try {
    const userId = req.query.userId || req.authContext?.userId;
    if (!userId) {
      return res.status(400).json({ ok: false, error: { message: "Missing userId" } });
    }

    let pref = await UserThemePreferences.findOne({ userId }).lean();
    if (!pref) {
      pref = {
        userId,
        orgId: req.authContext?.orgId || "default",
        selectedThemeKey: "auto",
        immersiveModeEnabled: true,
        reduceMotion: false,
        lowPerformanceMode: false,
        particlesEnabled: true,
      };
    }

    return res.status(200).json({ ok: true, preference: pref });
  } catch (err) {
    console.error("[ThemeEngine] Error fetching user preference:", err);
    return res.status(500).json({ ok: false, error: { message: "Failed to fetch preferences" } });
  }
});

/**
 * PUT /api/themes/preference
 * Updates or creates user theme preferences.
 */
router.put("/preference", optionalAuth, async (req, res) => {
  try {
    const userId = req.body.userId || req.authContext?.userId;
    if (!userId) {
      return res.status(400).json({ ok: false, error: { message: "Missing userId" } });
    }

    const {
      selectedThemeKey,
      immersiveModeEnabled,
      reduceMotion,
      lowPerformanceMode,
      particlesEnabled,
      orgId = "default",
    } = req.body;

    const updates = {};
    if (selectedThemeKey !== undefined) updates.selectedThemeKey = String(selectedThemeKey).trim();
    if (immersiveModeEnabled !== undefined) updates.immersiveModeEnabled = Boolean(immersiveModeEnabled);
    if (reduceMotion !== undefined) updates.reduceMotion = Boolean(reduceMotion);
    if (lowPerformanceMode !== undefined) updates.lowPerformanceMode = Boolean(lowPerformanceMode);
    if (particlesEnabled !== undefined) updates.particlesEnabled = Boolean(particlesEnabled);
    if (orgId) updates.orgId = orgId;

    const pref = await UserThemePreferences.findOneAndUpdate(
      { userId },
      { $set: updates },
      { upsert: true, new: true }
    );

    return res.status(200).json({ ok: true, preference: pref });
  } catch (err) {
    console.error("[ThemeEngine] Error updating user preference:", err);
    return res.status(500).json({ ok: false, error: { message: "Failed to save preference" } });
  }
});

/**
 * POST /api/themes/seed
 * Forces re-seeding default manifests and procedural assets.
 */
router.post("/seed", optionalAuth, async (req, res) => {
  try {
    const performer = req.authContext?.userId || "manual_api_trigger";
    const result = await seedDefaultHolidayThemes({ performedBy: performer });
    return res.status(200).json(result);
  } catch (err) {
    console.error("[ThemeEngine] Error during theme seed:", err);
    return res.status(500).json({ ok: false, error: { message: err.message } });
  }
});

// --- Admin CRUD Endpoints ---

/**
 * GET /api/themes/schedules
 * Returns all configured holiday theme schedules.
 */
router.get("/schedules", optionalAuth, async (_req, res) => {
  try {
    const schedules = await getAllSchedules();
    return res.status(200).json({ ok: true, schedules });
  } catch (err) {
    console.error("[ThemeEngine] Error fetching schedules:", err);
    return res.status(500).json({ ok: false, error: { message: err.message } });
  }
});

/**
 * POST /api/themes/schedules
 * Creates or updates a theme schedule.
 */
router.post("/schedules", optionalAuth, async (req, res) => {
  try {
    const performer = req.authContext?.userId || "admin";
    const schedule = await upsertSchedule(req.body, performer);
    return res.status(200).json({ ok: true, schedule });
  } catch (err) {
    console.error("[ThemeEngine] Error saving schedule:", err);
    return res.status(500).json({ ok: false, error: { message: err.message } });
  }
});

/**
 * DELETE /api/themes/schedules/:id
 * Deletes a theme schedule.
 */
router.delete("/schedules/:id", optionalAuth, async (req, res) => {
  try {
    const performer = req.authContext?.userId || "admin";
    const deleted = await deleteSchedule(req.params.id, performer);
    return res.status(200).json({ ok: true, deleted: Boolean(deleted) });
  } catch (err) {
    console.error("[ThemeEngine] Error deleting schedule:", err);
    return res.status(500).json({ ok: false, error: { message: err.message } });
  }
});

/**
 * GET /api/themes/org-settings
 * Returns organization theme policy.
 */
router.get("/org-settings", optionalAuth, async (req, res) => {
  try {
    const orgId = String(req.query.orgId || req.authContext?.orgId || "default");
    const settings = await getOrgSettings(orgId);
    return res.status(200).json({ ok: true, settings });
  } catch (err) {
    console.error("[ThemeEngine] Error fetching org settings:", err);
    return res.status(500).json({ ok: false, error: { message: err.message } });
  }
});

/**
 * PUT /api/themes/org-settings
 * Updates organization theme policy.
 */
router.put("/org-settings", optionalAuth, async (req, res) => {
  try {
    const orgId = String(req.body.orgId || req.authContext?.orgId || "default");
    const performer = req.authContext?.userId || "admin";
    const settings = await updateOrgSettings(orgId, req.body, performer);
    return res.status(200).json({ ok: true, settings });
  } catch (err) {
    console.error("[ThemeEngine] Error updating org settings:", err);
    return res.status(500).json({ ok: false, error: { message: err.message } });
  }
});

/**
 * GET /api/themes/audit-logs
 * Returns theme audit history.
 */
router.get("/audit-logs", optionalAuth, async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const logs = await getAuditLogs(limit);
    return res.status(200).json({ ok: true, logs });
  } catch (err) {
    console.error("[ThemeEngine] Error fetching audit logs:", err);
    return res.status(500).json({ ok: false, error: { message: err.message } });
  }
});

/**
 * POST /api/themes
 * Upserts a custom holiday theme.
 */
router.post("/", optionalAuth, async (req, res) => {
  try {
    const performer = req.authContext?.userId || "admin";
    const theme = await upsertTheme(req.body, performer);
    return res.status(200).json({ ok: true, theme });
  } catch (err) {
    console.error("[ThemeEngine] Error saving theme:", err);
    return res.status(500).json({ ok: false, error: { message: err.message } });
  }
});

// --- Asset Upload & Management Endpoints ---

/**
 * POST /api/themes/assets/upload
 * Accepts multipart file upload and records ThemeAsset
 */
router.post("/assets/upload", optionalAuth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: { message: "No file uploaded" } });
    }

    const { themeKey, assetType, deviceVariant, loadPriority, width, height } = req.body;
    if (!themeKey || !assetType || !deviceVariant) {
      return res.status(400).json({
        ok: false,
        error: { message: "Missing required fields (themeKey, assetType, deviceVariant)" },
      });
    }

    const relativeUrl = `/uploads/theme-assets/${req.file.filename}`;
    const performer = req.authContext?.userId || "admin";

    const asset = await uploadThemeAsset(
      {
        themeKey,
        assetType,
        deviceVariant,
        cdnUrl: relativeUrl,
        fallbackUrl: relativeUrl,
        format: path.extname(req.file.originalname).replace(".", "") || "webp",
        dimensions: {
          width: parseInt(width, 10) || 1920,
          height: parseInt(height, 10) || 1080,
        },
        fileSize: req.file.size,
        loadPriority: loadPriority || "normal",
      },
      performer
    );

    return res.status(200).json({ ok: true, asset });
  } catch (err) {
    console.error("[ThemeEngine] Asset upload failed:", err);
    return res.status(500).json({ ok: false, error: { message: err.message || "Upload failed" } });
  }
});

/**
 * GET /api/themes/assets
 * Queries assets by themeKey, assetType, deviceVariant
 */
router.get("/assets", optionalAuth, async (req, res) => {
  try {
    const filter = {};
    if (req.query.themeKey) filter.themeKey = req.query.themeKey;
    if (req.query.assetType) filter.assetType = req.query.assetType;
    if (req.query.deviceVariant) filter.deviceVariant = req.query.deviceVariant;

    const assets = await getThemeAssets(filter);
    return res.status(200).json({ ok: true, assets });
  } catch (err) {
    console.error("[ThemeEngine] Error fetching assets:", err);
    return res.status(500).json({ ok: false, error: { message: err.message } });
  }
});

/**
 * DELETE /api/themes/assets/:id
 * Deletes asset by ID
 */
router.delete("/assets/:id", optionalAuth, async (req, res) => {
  try {
    const performer = req.authContext?.userId || "admin";
    const deleted = await deleteThemeAsset(req.params.id, performer);
    return res.status(200).json({ ok: true, deleted: Boolean(deleted) });
  } catch (err) {
    console.error("[ThemeEngine] Error deleting asset:", err);
    return res.status(500).json({ ok: false, error: { message: err.message } });
  }
});

module.exports = router;
