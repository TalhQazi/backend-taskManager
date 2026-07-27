const express = require("express");
const HeaderSettings = require("../models/HeaderSettings");
const { requireAuth } = require("../middleware/auth");
const { getResolvedHolidayTheme } = require("../utils/holidayEngine");
const { base64ToBuffer, uploadToS3 } = require("../lib/s3");

const router = express.Router();

// Helper function to get user ID from request
const getUserId = (req) => {
  return req.user?.sub || req.user?.id || req.user?._id || req.user?.userId;
};

// Get header settings for the current user
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: { message: "User not authenticated" } });
    }

    let settings = await HeaderSettings.findOne({ userId }).lean();
    if (!settings) {
      // Create default settings if none exist
      const doc = await HeaderSettings.create({ userId });
      settings = doc.toObject();
    }

    // Resolve dynamic active holiday theme
    const holidayTheme = await getResolvedHolidayTheme(userId);
    settings.holidayTheme = holidayTheme;

    res.json({ item: settings });
  } catch (err) {
    next(err);
  }
});

// Update header settings (requires authenticated user)
router.put("/", requireAuth, async (req, res, next) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: { message: "User not authenticated" } });
    }

    const updateData = req.body;

    // Validate background type
    if (updateData.backgroundType && !["color", "image"].includes(updateData.backgroundType)) {
      return res.status(400).json({ error: { message: "Invalid background type" } });
    }

    // Validate height range
    if (updateData.height !== undefined) {
      const height = Number(updateData.height);
      if (height < 80 || height > 300) {
        return res.status(400).json({ error: { message: "Height must be between 80 and 300 pixels" } });
      }
    }

    // Build the $set object for atomic update
    const $set = {};
    if (updateData.backgroundType !== undefined) $set.backgroundType = updateData.backgroundType;
    if (updateData.height !== undefined) $set.height = Number(updateData.height);

    if (updateData.colorConfig) {
      if (updateData.colorConfig.from) $set["colorConfig.from"] = updateData.colorConfig.from;
      if (updateData.colorConfig.via) $set["colorConfig.via"] = updateData.colorConfig.via;
      if (updateData.colorConfig.to) $set["colorConfig.to"] = updateData.colorConfig.to;
    }

    if (updateData.imageConfig) {
      if (updateData.imageConfig.dataUrl && updateData.imageConfig.dataUrl.startsWith("data:")) {
        try {
          const { buffer, mimeType } = base64ToBuffer(updateData.imageConfig.dataUrl);
          const savedUrl = await uploadToS3(buffer, "header-cover.jpg", mimeType, "headers");
          $set["imageConfig.dataUrl"] = savedUrl;
          $set["imageConfig.url"] = savedUrl;
        } catch (err) {
          console.error("[HeaderSettings] Failed to save custom header image:", err);
          return res.status(400).json({ error: { message: "Failed to upload header image" } });
        }
      } else if (updateData.imageConfig.dataUrl) {
        $set["imageConfig.dataUrl"] = updateData.imageConfig.dataUrl;
        $set["imageConfig.url"] = updateData.imageConfig.dataUrl;
      } else if (updateData.imageConfig.url) {
        $set["imageConfig.url"] = updateData.imageConfig.url;
        $set["imageConfig.dataUrl"] = updateData.imageConfig.url;
      }
      if (updateData.imageConfig.repeat) $set["imageConfig.repeat"] = updateData.imageConfig.repeat;
      if (updateData.imageConfig.size) $set["imageConfig.size"] = updateData.imageConfig.size;
      if (updateData.imageConfig.position) $set["imageConfig.position"] = updateData.imageConfig.position;
    }

    if (updateData.overlay) {
      if (updateData.overlay.enabled !== undefined) $set["overlay.enabled"] = updateData.overlay.enabled;
      if (updateData.overlay.color) $set["overlay.color"] = updateData.overlay.color;
    }

    const settings = await HeaderSettings.findOneAndUpdate(
      { userId },
      { $set },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();

    res.json({ item: settings });
  } catch (err) {
    next(err);
  }
});

// Reset to defaults for the current user
router.post("/reset", requireAuth, async (req, res, next) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: { message: "User not authenticated" } });
    }

    await HeaderSettings.deleteMany({ userId });
    const settings = await HeaderSettings.create({ userId });

    res.json({ item: settings.toObject(), message: "Reset to defaults" });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
