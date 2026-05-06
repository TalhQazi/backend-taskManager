const express = require("express");
const { z } = require("zod");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const CompanyRegistry = require("../models/CompanyRegistry");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// Ensure upload directory exists
const uploadDir = path.join(__dirname, "../../uploads/company-registry");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB per file
});

const companyRegistrySchema = z.object({
  companyName: z.string().min(1, "Company name is required"),
  entityType: z.string().optional().default(""),
  fein: z.string().optional().default(""),
  phone: z.string().optional().default(""),
  email: z.string().optional().default(""),
  status: z.enum(["active", "hold", "archived"]).optional().default("active"),
  notes: z.string().optional().default(""),
  colorTag: z.enum(["green", "blue", "yellow", "red", "gray"]).optional().default("blue"),
  attachments: z.array(z.object({
    name: z.string().optional().default(""),
    url: z.string().optional().default(""),
    type: z.string().optional().default(""),
  })).optional().default([]),
});

const updateSchema = companyRegistrySchema.partial();

// GET all company registry entries
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const { status, colorTag, search } = req.query;
    const filter = {};

    if (status && status !== "all") {
      filter.status = status;
    }
    if (colorTag && colorTag !== "all") {
      filter.colorTag = colorTag;
    }
    if (search) {
      filter.$or = [
        { companyName: { $regex: search, $options: "i" } },
        { fein: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }

    const items = await CompanyRegistry.find(filter).sort({ createdAt: -1 }).lean();
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

// GET single company registry entry
router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const entry = await CompanyRegistry.findById(req.params.id).lean();
    if (!entry) {
      return res.status(404).json({ error: { message: "Company registry entry not found" } });
    }
    res.json({ item: entry });
  } catch (err) {
    next(err);
  }
});

// POST create company registry entry with file uploads
router.post("/", requireAuth, upload.array("files", 10), async (req, res, next) => {
  try {
    // Parse JSON body fields from req.body
    const body = {
      companyName: req.body.companyName || "",
      entityType: req.body.entityType || "",
      fein: req.body.fein || "",
      phone: req.body.phone || "",
      email: req.body.email || "",
      status: req.body.status || "active",
      notes: req.body.notes || "",
      colorTag: req.body.colorTag || "blue",
    };

    const parsed = companyRegistrySchema.safeParse(body);
    if (!parsed.success) {
      // Clean up uploaded files on validation error
      if (req.files) {
        req.files.forEach(f => {
          try { fs.unlinkSync(f.path); } catch(e) {}
        });
      }
      return res.status(400).json({
        error: {
          message: "Invalid payload",
          details: parsed.error.errors,
        },
      });
    }

    // Build attachments array from uploaded files
    const attachments = [];
    if (req.files && req.files.length > 0) {
      req.files.forEach(file => {
        attachments.push({
          name: file.originalname,
          url: `/uploads/company-registry/${file.filename}`,
          type: file.mimetype,
        });
      });
    }

    const created = await CompanyRegistry.create({
      ...parsed.data,
      attachments,
    });

    res.status(201).json({ item: created.toObject() });
  } catch (err) {
    // Clean up uploaded files on error
    if (req.files) {
      req.files.forEach(f => {
        try { fs.unlinkSync(f.path); } catch(e) {}
      });
    }
    next(err);
  }
});

// PUT update company registry entry
router.put("/:id", requireAuth, upload.array("files", 10), async (req, res, next) => {
  try {
    const body = {
      companyName: req.body.companyName || "",
      entityType: req.body.entityType || "",
      fein: req.body.fein || "",
      phone: req.body.phone || "",
      email: req.body.email || "",
      status: req.body.status || "active",
      notes: req.body.notes || "",
      colorTag: req.body.colorTag || "blue",
    };

    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      if (req.files) {
        req.files.forEach(f => {
          try { fs.unlinkSync(f.path); } catch(e) {}
        });
      }
      return res.status(400).json({
        error: {
          message: "Invalid payload",
          details: parsed.error.errors,
        },
      });
    }

    const existing = await CompanyRegistry.findById(req.params.id).lean();
    if (!existing) {
      if (req.files) {
        req.files.forEach(f => {
          try { fs.unlinkSync(f.path); } catch(e) {}
        });
      }
      return res.status(404).json({ error: { message: "Company registry entry not found" } });
    }

    // Merge existing attachments with new uploads
    let attachments = existing.attachments || [];
    if (req.files && req.files.length > 0) {
      req.files.forEach(file => {
        attachments.push({
          name: file.originalname,
          url: `/uploads/company-registry/${file.filename}`,
          type: file.mimetype,
        });
      });
    }

    const updated = await CompanyRegistry.findByIdAndUpdate(
      req.params.id,
      { $set: { ...parsed.data, attachments } },
      { new: true }
    ).lean();

    res.json({ item: updated });
  } catch (err) {
    if (req.files) {
      req.files.forEach(f => {
        try { fs.unlinkSync(f.path); } catch(e) {}
      });
    }
    next(err);
  }
});

// DELETE company registry entry
router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const deleted = await CompanyRegistry.findByIdAndDelete(req.params.id).lean();

    if (!deleted) {
      return res.status(404).json({ error: { message: "Company registry entry not found" } });
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
