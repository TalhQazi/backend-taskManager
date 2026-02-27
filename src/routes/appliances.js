const express = require("express");
const { z } = require("zod");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const Appliance = require("../models/Appliance");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const uploadsDir = path.resolve(__dirname, "..", "..", "uploads", "appliances");
try {
  fs.mkdirSync(uploadsDir, { recursive: true });
} catch {
  
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const safeOriginal = String(file.originalname || "file").replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}_${safeOriginal}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
});

const createSchema = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
  serialNumber: z.string().min(1),
  status: z.enum(["operational", "needs-repair", "out-of-service"]).optional(),
  location: z.string().min(1),
  warrantyExpiry: z.string().optional().default(""),
  lastMaintenance: z.string().optional().default(""),
  assignedTo: z.string().optional().nullable(),
});

const updateSchema = createSchema.partial();

router.get("/", requireAuth, async (_req, res, next) => {
  try {
    const items = await Appliance.find().sort({ createdAt: -1 }).lean();
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

router.post("/", requireAuth, async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { message: "Invalid payload" } });

    const created = await Appliance.create(parsed.data);
    res.status(201).json({ item: created.toObject() });
  } catch (err) {
    next(err);
  }
});

router.put("/:id", requireAuth, async (req, res, next) => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { message: "Invalid payload" } });

    const updated = await Appliance.findByIdAndUpdate(req.params.id, parsed.data, { new: true }).lean();
    if (!updated) return res.status(404).json({ error: { message: "Appliance not found" } });

    res.json({ item: updated });
  } catch (err) {
    next(err);
  }
});

router.post("/upload", requireAuth, upload.single("tagPhotoFile"), async (req, res, next) => {
  try {
    const body = req.body || {};
    const f = req.file;

    const tagPhotoAttachment = f
      ? {
          fileName: f.originalname,
          url: `/uploads/appliances/${f.filename}`,
          mimeType: f.mimetype,
          size: f.size,
        }
      : undefined;

    const created = await Appliance.create({
      name: body.name,
      category: body.type || body.category || "appliance",
      serialNumber: body.location || body.serialNumber || "N/A",
      status: body.status || "operational",
      location: body.location || "",
      warrantyExpiry: body.warrantyUntil || "",
      lastMaintenance: body.purchaseDate || "",
      assignedTo: null,
      tagPhotoFileName: f?.originalname || body.tagPhotoFileName || "",
      tagPhotoAttachment,
    });

    return res.status(201).json({ item: created.toObject() });
  } catch (err) {
    return next(err);
  }
});

router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const deleted = await Appliance.findByIdAndDelete(req.params.id).lean();
    if (!deleted) return res.status(404).json({ error: { message: "Appliance not found" } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
