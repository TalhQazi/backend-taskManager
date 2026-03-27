const express = require("express");
const Website = require("../models/Website");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// Get all active websites - MUST come before /:id route
router.get("/active", async (req, res, next) => {
  try {
    const websites = await Website.find({ websiteType: "active" })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ items: websites });
  } catch (err) {
    next(err);
  }
});

// Get all future websites - MUST come before /:id route
router.get("/future", async (req, res, next) => {
  try {
    const websites = await Website.find({ websiteType: "future" })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ items: websites });
  } catch (err) {
    next(err);
  }
});

// Get single website by ID
router.get("/:id", async (req, res, next) => {
  try {
    const website = await Website.findById(req.params.id).lean();
    if (!website) {
      return res.status(404).json({ error: { message: "Website not found" } });
    }
    res.json({ item: website });
  } catch (err) {
    next(err);
  }
});

// Create new website (requires auth)
router.post("/", requireAuth, async (req, res, next) => {
  try {
    const { siteName, url, websiteType, ...rest } = req.body;

    if (!siteName || !url || !websiteType) {
      return res.status(400).json({
        error: { message: "siteName, url, and websiteType are required" },
      });
    }

    const newWebsite = new Website({
      siteName,
      url,
      websiteType,
      ...rest,
      createdBy: req.user?.username || "System",
    });

    await newWebsite.save();
    res.status(201).json({ item: newWebsite });
  } catch (err) {
    next(err);
  }
});

// Update website (requires auth)
router.put("/:id", requireAuth, async (req, res, next) => {
  try {
    const { siteName, url, websiteType, ...rest } = req.body;

    const website = await Website.findByIdAndUpdate(
      req.params.id,
      { siteName, url, websiteType, ...rest },
      { new: true, runValidators: true }
    );

    if (!website) {
      return res.status(404).json({ error: { message: "Website not found" } });
    }

    res.json({ item: website });
  } catch (err) {
    next(err);
  }
});

// Delete website (requires auth)
router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const website = await Website.findByIdAndDelete(req.params.id);
    if (!website) {
      return res.status(404).json({ error: { message: "Website not found" } });
    }
    res.json({ message: "Website deleted successfully" });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
