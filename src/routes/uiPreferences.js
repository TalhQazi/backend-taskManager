const express = require("express");
const router = express.Router();
const UserPreference = require("../models/UserPreference");
const { requireAuth, requireSuperAdmin, requireAdmin, requireManager } = require("../middleware/auth");

// Helper function to get user ID from request
const getUserId = (req) => {
  return req.user?.sub || req.user?.id || req.user?._id || req.user?.userId;
};

// GET /api/ui-preferences - Get user UI preferences
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: { message: "User not authenticated" } });
    }

    let preferences = await UserPreference.findOne({ userId });

    // Create default preferences if not found
    if (!preferences) {
      preferences = new UserPreference({ userId });
      await preferences.save();
    }

    // Return only UI preferences
    const uiPrefs = preferences.uiPreferences || {};
    res.json({ item: uiPrefs });
  } catch (err) {
    next(err);
  }
});

// PUT /api/ui-preferences - Update user UI preferences
router.put("/", requireAuth, async (req, res, next) => {
  try {
    console.log("[ui-preferences] req.user=", req.user);
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: { message: "User not authenticated" } });
    }

    const updates = req.body;

    const isLikelyColorString = (v) => typeof v === "string" && v.trim().length > 0 && v.trim().length <= 64;

    // Validate theme if provided
    if (updates.theme) {
      const validThemes = ["neon-tech", "metallic-elite", "executive-black", "dark-minimal", "high-contrast", "energy-mode", "crystal-white"];
      if (!validThemes.includes(updates.theme)) {
        return res.status(400).json({ error: { message: "Invalid theme" } });
      }
    }

    // Validate card style if provided
    if (updates.cardStyle) {
      const validCardStyles = ["glass", "neon", "metallic", "flat"];
      if (!validCardStyles.includes(updates.cardStyle)) {
        return res.status(400).json({ error: { message: "Invalid card style" } });
      }
    }

    // Validate animation speed if provided
    if (updates.animationSpeed) {
      const validSpeeds = ["slow", "normal", "fast"];
      if (!validSpeeds.includes(updates.animationSpeed)) {
        return res.status(400).json({ error: { message: "Invalid animation speed" } });
      }
    }

    // Validate layout density if provided
    if (updates.layoutDensity) {
      const validDensities = ["compact", "comfortable", "spacious"];
      if (!validDensities.includes(updates.layoutDensity)) {
        return res.status(400).json({ error: { message: "Invalid layout density" } });
      }
    }

    // Validate glow intensity if provided
    if (updates.glowIntensity !== undefined) {
      if (typeof updates.glowIntensity !== "number" || updates.glowIntensity < 0 || updates.glowIntensity > 100) {
        return res.status(400).json({ error: { message: "Glow intensity must be between 0 and 100" } });
      }
    }

    if (updates.panelColors) {
      const p = updates.panelColors;
      const keys = [
        "headerBackground",
        "headerOverlayColor",
        "sidebarBackground",
        "dashboardBackground",
        "sidebarIconColor",
        "dashboardIconColor",
        "sidebarTextColor",
        "dashboardCardBackground",
      ];
      for (const k of keys) {
        if (p[k] !== undefined && !isLikelyColorString(p[k])) {
          return res.status(400).json({ error: { message: `Invalid panel color: ${k}` } });
        }
      }

      if (p.headerOverlayOpacity !== undefined) {
        if (typeof p.headerOverlayOpacity !== "number" || p.headerOverlayOpacity < 0 || p.headerOverlayOpacity > 100) {
          return res.status(400).json({ error: { message: "Invalid panel color: headerOverlayOpacity" } });
        }
      }
    }

    // Validate custom colors if provided
    if (updates.customColors) {
      const colorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
      if (updates.customColors.primary && !colorRegex.test(updates.customColors.primary)) {
        return res.status(400).json({ error: { message: "Invalid primary color format" } });
      }
      if (updates.customColors.secondary && !colorRegex.test(updates.customColors.secondary)) {
        return res.status(400).json({ error: { message: "Invalid secondary color format" } });
      }
      if (updates.customColors.accent && !colorRegex.test(updates.customColors.accent)) {
        return res.status(400).json({ error: { message: "Invalid accent color format" } });
      }
      if (updates.customColors.textColor && !colorRegex.test(updates.customColors.textColor)) {
        return res.status(400).json({ error: { message: "Invalid text color format" } });
      }
    }

    let preferences = await UserPreference.findOne({ userId });

    if (!preferences) {
      preferences = new UserPreference({ userId });
    }

    // Merge updates into uiPreferences
    preferences.uiPreferences = {
      ...preferences.uiPreferences?.toObject() || {},
      ...updates
    };

    if (updates.panelColors) {
      preferences.uiPreferences.panelColors = updates.panelColors;
    }

    await preferences.save();

    res.json({ item: preferences.uiPreferences });
  } catch (err) {
    next(err);
  }
});

// PUT /api/ui-preferences/layout - Update layout configuration
router.put("/layout", requireAuth, async (req, res, next) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: { message: "User not authenticated" } });
    }

    const { layoutConfig } = req.body;

    if (!layoutConfig || typeof layoutConfig !== "object") {
      return res.status(400).json({ error: { message: "Invalid layout configuration" } });
    }

    let preferences = await UserPreference.findOne({ userId });

    if (!preferences) {
      preferences = new UserPreference({ userId });
    }

    // Update layout config
    preferences.uiPreferences = {
      ...preferences.uiPreferences?.toObject() || {},
      layoutConfig: new Map(Object.entries(layoutConfig))
    };

    await preferences.save();

    res.json({ item: preferences.uiPreferences });
  } catch (err) {
    next(err);
  }
});

// POST /api/ui-preferences/reset - Reset to default preferences
router.post("/reset", requireAuth, async (req, res, next) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: { message: "User not authenticated" } });
    }

    let preferences = await UserPreference.findOne({ userId });

    if (!preferences) {
      preferences = new UserPreference({ userId });
    } else {
      // Reset only UI preferences, keep other preferences
      preferences.uiPreferences = {
        theme: "dark-minimal",
        customColors: {
          primary: "#133767",
          secondary: "#3b82f6",
          accent: "#8b5cf6"
        },
        panelColors: {
          headerBackground: "#133767",
          headerOverlayColor: "#000000",
          headerOverlayOpacity: 30,
          sidebarBackground: "#0B1323",
          dashboardBackground: "#e6f0ff",
          sidebarIconColor: "#ffffff",
          dashboardIconColor: "#133767",
          sidebarTextColor: "#ffffff",
          dashboardCardBackground: "#ffffff",
        },
        glowIntensity: 50,
        animationSpeed: "normal",
        cardStyle: "glass",
        layoutDensity: "comfortable",
        layoutConfig: new Map(),
        animationSettings: {
          enabled: true,
          reduceMotion: false,
          hoverEffects: true,
          clickEffects: true
        }
      };
    }

    await preferences.save();

    res.json({ item: preferences.uiPreferences, message: "UI preferences reset to default" });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
