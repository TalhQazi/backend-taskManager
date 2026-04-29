const express = require("express");
const AdminInfo = require("../models/AdminInfo");
const { requireAuth, requireSuperAdmin, requireAdmin, requireManager } = require("../middleware/auth");

const router = express.Router();

// Get all admin info - for admin panel (MUST come BEFORE /:id route)
router.get("/admin/all", requireAuth, async (req, res, next) => {
  try {
    const role = String(req.user?.role || "").toLowerCase();
    if (role !== "admin" && role !== "super-admin") {
      return res.status(403).json({ error: { message: "Forbidden: Admin access required" } });
    }

    const adminInfos = await AdminInfo.find()
      .sort({ createdAt: -1 })
      .lean();
    res.json({ items: adminInfos });
  } catch (err) {
    next(err);
  }
});

// Get all admin info (public - no auth required)
router.get("/", async (_req, res, next) => {
  try {
    const adminInfos = await AdminInfo.find()
      .sort({ createdAt: -1 })
      .lean();
    res.json({ items: adminInfos });
  } catch (err) {
    next(err);
  }
});

// Get single admin info by ID (MUST come AFTER /admin/all)
router.get("/:id", async (req, res, next) => {
  try {
    const adminInfo = await AdminInfo.findById(req.params.id).lean();
    if (!adminInfo) {
      return res.status(404).json({ error: { message: "Admin info not found" } });
    }
    res.json({ item: adminInfo });
  } catch (err) {
    next(err);
  }
});

// Create new admin info (requires admin/super-admin)
// Flexible: can be text only, media only, or combination
router.post("/", requireAuth, async (req, res, next) => {
  try {
    const role = String(req.user?.role || "").toLowerCase();
    if (role !== "admin" && role !== "super-admin") {
      return res.status(403).json({ error: { message: "Forbidden: Admin access required" } });
    }

    const { title, text, media } = req.body;

    // Validation: at least text OR media must be provided
    const hasText = text && typeof text === "string" && text.trim().length > 0;
    const hasMedia = media && Array.isArray(media) && media.length > 0;

    if (!hasText && !hasMedia) {
      return res.status(400).json({ 
        error: { message: "At least text or media (image/file) is required" } 
      });
    }

    // Validate media if provided
    if (hasMedia) {
      for (const mediaItem of media) {
        if (!mediaItem.type || !mediaItem.fileName || !mediaItem.dataUrl || !mediaItem.mimeType) {
          return res.status(400).json({ 
            error: { message: "Invalid media format: each media item must have type, fileName, dataUrl, and mimeType" } 
          });
        }
        if (!["image", "file"].includes(mediaItem.type)) {
          return res.status(400).json({ error: { message: "Invalid media type" } });
        }
        // Validate file size (max 10MB per file)
        if (mediaItem.size && mediaItem.size > 10 * 1024 * 1024) {
          return res.status(400).json({ error: { message: "File size exceeds 10MB limit" } });
        }
      }
    }

    const newAdminInfo = new AdminInfo({
      title: title && typeof title === "string" ? title.trim() : "",
      text: hasText ? text.trim() : "",
      media: hasMedia ? media : [],
      createdBy: req.user?.username || "System",
    });

    await newAdminInfo.save();
    res.status(201).json({ item: newAdminInfo });
  } catch (err) {
    next(err);
  }
});

// Update admin info (requires admin/super-admin)
// Flexible: can be text only, media only, or combination
router.put("/:id", requireAuth, async (req, res, next) => {
  try {
    const role = String(req.user?.role || "").toLowerCase();
    if (role !== "admin" && role !== "super-admin") {
      return res.status(403).json({ error: { message: "Forbidden: Admin access required" } });
    }

    const { title, text, media } = req.body;

    // Find the item
    const adminInfo = await AdminInfo.findById(req.params.id);
    if (!adminInfo) {
      return res.status(404).json({ error: { message: "Admin info not found" } });
    }

    // Validation: at least text OR media must be provided
    const hasText = text && typeof text === "string" && text.trim().length > 0;
    const hasMedia = media && Array.isArray(media) && media.length > 0;

    if (!hasText && !hasMedia) {
      return res.status(400).json({ 
        error: { message: "At least text or media (image/file) is required" } 
      });
    }

    // Validate media if provided
    if (hasMedia) {
      for (const mediaItem of media) {
        if (!mediaItem.type || !mediaItem.fileName || !mediaItem.dataUrl || !mediaItem.mimeType) {
          return res.status(400).json({ 
            error: { message: "Invalid media format: each media item must have type, fileName, dataUrl, and mimeType" } 
          });
        }
        if (!["image", "file"].includes(mediaItem.type)) {
          return res.status(400).json({ error: { message: "Invalid media type" } });
        }
        if (mediaItem.size && mediaItem.size > 10 * 1024 * 1024) {
          return res.status(400).json({ error: { message: "File size exceeds 10MB limit" } });
        }
      }
    }

    // Update fields
    if (title !== undefined) {
      adminInfo.title = title && typeof title === "string" ? title.trim() : "";
    }
    if (hasText) {
      adminInfo.text = text.trim();
    }
    if (hasMedia) {
      adminInfo.media = media;
    }

    await adminInfo.save();
    res.json({ item: adminInfo });
  } catch (err) {
    next(err);
  }
});

// Delete admin info (requires admin/super-admin)
router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const role = String(req.user?.role || "").toLowerCase();
    if (role !== "admin" && role !== "super-admin") {
      return res.status(403).json({ error: { message: "Forbidden: Admin access required" } });
    }

    const adminInfo = await AdminInfo.findByIdAndDelete(req.params.id);
    if (!adminInfo) {
      return res.status(404).json({ error: { message: "Admin info not found" } });
    }

    res.json({ message: "Admin info deleted successfully" });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
