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

    let settings = await HeaderSettings.findOne();
    if (!settings) {
      settings = await HeaderSettings.create(updateData);
    } else {
      // Update fields
      if (updateData.backgroundType !== undefined) settings.backgroundType = updateData.backgroundType;
      if (updateData.colorConfig) settings.colorConfig = { ...settings.colorConfig, ...updateData.colorConfig };
      if (updateData.imageConfig) settings.imageConfig = { ...settings.imageConfig, ...updateData.imageConfig };
      if (updateData.height !== undefined) settings.height = updateData.height;
      if (updateData.overlay) settings.overlay = { ...settings.overlay, ...updateData.overlay };
      await settings.save();
    }

    res.json({ item: settings.toObject() });
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
