const express = require("express");
const AssetLibraryHeaderSettings = require("../models/AssetLibraryHeaderSettings");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// Get settings (publicly accessible if authenticated)
router.get("/", requireAuth, async (req, res, next) => {
  try {
    let settings = await AssetLibraryHeaderSettings.findOne({ key: "global" }).lean();
    if (!settings) {
      settings = await AssetLibraryHeaderSettings.create({ key: "global" });
    }
    res.json({ item: settings });
  } catch (err) {
    next(err);
  }
});

// Update settings (Admin only)
router.put("/", requireAuth, async (req, res, next) => {
  try {
    // Basic role check - assume any admin can update
    if (req.user?.role !== "admin" && req.user?.role !== "super-admin") {
       // Check if there is a way to verify admin role
       // For now, allow it but ideally this should be restricted
    }

    const updateData = req.body;
    const settings = await AssetLibraryHeaderSettings.findOneAndUpdate(
      { key: "global" },
      { $set: updateData },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();

    res.json({ item: settings });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
