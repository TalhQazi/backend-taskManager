const express = require("express");
const { z } = require("zod");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const CRMFile = require("../models/CRMFile");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const uploadDir = path.join(__dirname, "../../uploads/crm-files");
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
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB per file
});

const createSchema = z.object({
  linkedContact: z.string().optional().default(""),
  linkedDeal: z.string().optional().default(""),
  type: z.enum(['Contract', 'Proposal', 'Invoice', 'Other']).optional().default('Other'),
  date: z.string().optional(),
  fileName: z.string().optional(),
});

function safeJson(doc) {
  if (!doc) return doc;
  const obj = doc.toObject ? doc.toObject() : doc;
  const { __v, ...rest } = obj;
  return { ...rest, id: String(obj._id) };
}

router.get("/", requireAuth, async (req, res, next) => {
  try {
    const { search } = req.query;
    const filter = {};

    if (search) {
      const searchRegex = new RegExp(search, "i");
      filter.$or = [
        { originalName: searchRegex },
        { linkedContact: searchRegex },
        { linkedDeal: searchRegex },
        { uploadedBy: searchRegex },
      ];
    }

    const items = await CRMFile.find(filter).sort({ uploadedAt: -1 }).lean();
    res.json({ items: items.map(safeJson) });
  } catch (err) {
    next(err);
  }
});

router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const item = await CRMFile.findById(req.params.id).lean();
    if (!item) {
      return res.status(404).json({ error: { message: "CRM file not found" } });
    }
    res.json({ item: safeJson(item) });
  } catch (err) {
    next(err);
  }
});

router.post("/upload", requireAuth, upload.array("files", 20), async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse({
      linkedContact: req.body.linkedContact || "",
      linkedDeal: req.body.linkedDeal || "",
      type: req.body.type || "Other",
      date: req.body.date,
      fileName: req.body.fileName,
    });

    if (!parsed.success) {
      if (req.files) {
        req.files.forEach((f) => {
          try { fs.unlinkSync(f.path); } catch {}
        });
      }
      return res.status(400).json({ error: { message: parsed.error.errors[0]?.message || "Invalid payload" } });
    }

    const files = Array.isArray(req.files) ? req.files : [];
    if (files.length === 0) {
      return res.status(400).json({ error: { message: "No files were uploaded" } });
    }

    const createdItems = await CRMFile.insertMany(
      files.map((file) => ({
        originalName: file.originalname,
        fileName: parsed.data.fileName || file.filename,
        mimeType: file.mimetype,
        size: file.size,
        url: `/uploads/crm-files/${file.filename}`,
        linkedContact: parsed.data.linkedContact,
        linkedDeal: parsed.data.linkedDeal,
        type: parsed.data.type,
        date: parsed.data.date ? new Date(parsed.data.date) : new Date(),
        uploadedAt: new Date(),
        createdBy: req.user?.id,
      }))
    );

    res.status(201).json({ items: createdItems.map(safeJson) });
  } catch (err) {
    if (req.files) {
      req.files.forEach((f) => {
        try { fs.unlinkSync(f.path); } catch {}
      });
    }
    next(err);
  }
});

router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const item = await CRMFile.findByIdAndDelete(req.params.id).lean();
    if (!item) {
      return res.status(404).json({ error: { message: "CRM file not found" } });
    }

    if (item.url) {
      const localPath = path.join(__dirname, "../../", item.url.replace(/^\//, ""));
      try {
        fs.unlinkSync(localPath);
      } catch {
        // ignore missing file cleanup issues
      }
    }

    res.json({ item: safeJson(item) });
  } catch (err) {
    next(err);
  }
});

router.get("/:id/download", requireAuth, async (req, res, next) => {
  try {
    const item = await CRMFile.findById(req.params.id).lean();
    if (!item) {
      return res.status(404).json({ error: { message: "CRM file not found" } });
    }

    const filePath = path.join(__dirname, "../../", item.url.replace(/^\//, ""));
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: { message: "File is not available on the server" } });
    }

    res.download(filePath, item.originalName);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
