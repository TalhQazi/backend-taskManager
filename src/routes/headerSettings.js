const express = require("express");
const HeaderSettings = require("../models/HeaderSettings");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// Get header settings (public - no auth required for viewing)
router.get("/", async (_req, res, next) => {
  try {
    let settings = await HeaderSettings.findOne().lean();
    if (!settings) {
      // Create default settings if none exist
      settings = await HeaderSettings.create({});
    }
    res.json({ item: settings });
  } catch (err) {
    next(err);
  }
});

// Update header settings (requires admin/super-admin)
router.put("/", requireAuth, async (req, res, next) => {
  try {
    const role = String(req.user?.role || "").toLowerCase();
    if (role !== "admin" && role !== "super-admin") {
      return res.status(403).json({ error: { message: "Forbidden: Admin access required" } });
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
      // Only store dataUrl once (url is redundant and doubles the size)
      if (updateData.imageConfig.dataUrl) {
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
      {},
      { $set },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();

    res.json({ item: settings });
  } catch (err) {
    next(err);
  }
});

// Reset to defaults
router.post("/reset", requireAuth, async (req, res, next) => {
  try {
    const role = String(req.user?.role || "").toLowerCase();
    if (role !== "admin" && role !== "super-admin") {
      return res.status(403).json({ error: { message: "Forbidden: Admin access required" } });
    }

    await HeaderSettings.deleteMany({});
    const settings = await HeaderSettings.create({});

    res.json({ item: settings.toObject(), message: "Reset to defaults" });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
