const express = require("express");
const { z } = require("zod");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const Onboarding = require("../models/Onboarding");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const uploadsDir = path.resolve(__dirname, "..", "..", "uploads", "onboarding");
try {
  fs.mkdirSync(uploadsDir, { recursive: true });
} catch {
  
}

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
});

function withId(doc) {
  if (!doc) return doc;
  return { ...doc, id: String(doc._id) };
}

const adminUiSchema = z.object({
  name: z.string().min(1),
  email: z.string().optional(),
  startDate: z.string().min(1),
  progress: z.number().optional(),
  approvalStatus: z.string().optional(),
  w4FileName: z.string().optional(),
  i9FileName: z.string().optional(),
  signatureFileName: z.string().optional(),
  generatedPdfFileName: z.string().optional(),
});

const createSchema = z.object({
  employeeName: z.string().min(1),
  role: z.string().min(1),
  startDate: z.string().min(1),
  progress: z.number().min(0).max(100),
  documentsUploaded: z.number().min(0),
  documentsRequired: z.number().min(0),
  approvalStatus: z.enum(["pending", "approved", "rejected"]),
  w4Attachment: z.object({
    fileName: z.string().optional(),
    url: z.string().optional(),
    mimeType: z.string().optional(),
    size: z.number().optional(),
  }).optional(),
  i9Attachment: z.object({
    fileName: z.string().optional(),
    url: z.string().optional(),
    mimeType: z.string().optional(),
    size: z.number().optional(),
  }).optional(),
  signatureAttachment: z.object({
    fileName: z.string().optional(),
    url: z.string().optional(),
    mimeType: z.string().optional(),
    size: z.number().optional(),
  }).optional(),
  generatedPdfAttachment: z.object({
    fileName: z.string().optional(),
    url: z.string().optional(),
    mimeType: z.string().optional(),
    size: z.number().optional(),
  }).optional(),
});

const updateSchema = createSchema.partial();

router.get("/", requireAuth, async (_req, res, next) => {
  try {
    const items = await Onboarding.find().sort({ createdAt: -1 }).lean();
    res.json({ items: items.map(withId) });
  } catch (err) {
    next(err);
  }
});

router.post("/", requireAuth, async (req, res, next) => {
  try {
    const adminParsed = adminUiSchema.safeParse(req.body);
    if (adminParsed.success) {
      const docs = [
        adminParsed.data.w4FileName,
        adminParsed.data.i9FileName,
        adminParsed.data.signatureFileName,
        adminParsed.data.generatedPdfFileName,
      ].filter((x) => typeof x === "string" && x.trim()).length;

      const rawApproval = String(adminParsed.data.approvalStatus || "pending").toLowerCase();
      const approval = ["pending", "approved", "rejected"].includes(rawApproval) ? rawApproval : "pending";

      const created = await Onboarding.create({
        employeeName: adminParsed.data.name,
        role: "Employee",
        startDate: adminParsed.data.startDate,
        progress: Number.isFinite(adminParsed.data.progress) ? adminParsed.data.progress : 0,
        documentsUploaded: docs,
        documentsRequired: 4,
        approvalStatus: approval,
      });

      return res.status(201).json({ item: withId(created.toObject()) });
    }

    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { message: "Invalid payload" } });

    const created = await Onboarding.create(parsed.data);
    res.status(201).json({ item: withId(created.toObject()) });
  } catch (err) {
    next(err);
  }
});

router.put("/:id", requireAuth, async (req, res, next) => {
  try {
    const adminParsed = adminUiSchema.partial().safeParse(req.body);
    if (adminParsed.success) {
      const patch = {};
      if (typeof adminParsed.data.name === "string") patch.employeeName = adminParsed.data.name;
      if (typeof adminParsed.data.startDate === "string") patch.startDate = adminParsed.data.startDate;
      if (typeof adminParsed.data.progress === "number") patch.progress = adminParsed.data.progress;

      if (typeof adminParsed.data.approvalStatus === "string") {
        const rawApproval = String(adminParsed.data.approvalStatus || "pending").toLowerCase();
        patch.approvalStatus = ["pending", "approved", "rejected"].includes(rawApproval) ? rawApproval : "pending";
      }

      const files = [
        adminParsed.data.w4FileName,
        adminParsed.data.i9FileName,
        adminParsed.data.signatureFileName,
        adminParsed.data.generatedPdfFileName,
      ].filter((x) => typeof x === "string" && x.trim()).length;
      if (files > 0) patch.documentsUploaded = files;

      const updated = await Onboarding.findByIdAndUpdate(req.params.id, patch, { new: true }).lean();
      if (!updated) return res.status(404).json({ error: { message: "Onboarding item not found" } });
      return res.json({ item: withId(updated) });
    }

    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { message: "Invalid payload" } });

    const updated = await Onboarding.findByIdAndUpdate(req.params.id, parsed.data, { new: true }).lean();
    if (!updated) return res.status(404).json({ error: { message: "Onboarding item not found" } });

    res.json({ item: withId(updated) });
  } catch (err) {
    next(err);
  }
});

router.post("/upload", requireAuth, upload.fields([
  { name: "w4File", maxCount: 1 },
  { name: "i9File", maxCount: 1 },
  { name: "signatureFile", maxCount: 1 },
  { name: "generatedPdfFile", maxCount: 1 },
]), async (req, res, next) => {
  try {
    const body = req.body || {};
    const files = req.files || {};

    const w4File = Array.isArray(files.w4File) ? files.w4File[0] : undefined;
    const i9File = Array.isArray(files.i9File) ? files.i9File[0] : undefined;
    const signatureFile = Array.isArray(files.signatureFile) ? files.signatureFile[0] : undefined;
    const generatedPdfFile = Array.isArray(files.generatedPdfFile) ? files.generatedPdfFile[0] : undefined;

    const docs = [
      w4File?.originalname || body.w4FileName,
      i9File?.originalname || body.i9FileName,
      signatureFile?.originalname || body.signatureFileName,
      generatedPdfFile?.originalname || body.generatedPdfFileName,
    ].filter((x) => typeof x === "string" && x.trim()).length;

    const rawApproval = String(body.approvalStatus || "pending").toLowerCase();
    const approval = ["pending", "approved", "rejected"].includes(rawApproval) ? rawApproval : "pending";

    const w4Attachment = w4File
      ? { fileName: w4File.originalname, url: null, mimeType: w4File.mimetype, size: w4File.size }
      : undefined;
    const i9Attachment = i9File
      ? { fileName: i9File.originalname, url: null, mimeType: i9File.mimetype, size: i9File.size }
      : undefined;
    const signatureAttachment = signatureFile
      ? { fileName: signatureFile.originalname, url: null, mimeType: signatureFile.mimetype, size: signatureFile.size }
      : undefined;
    const generatedPdfAttachment = generatedPdfFile
      ? { fileName: generatedPdfFile.originalname, url: null, mimeType: generatedPdfFile.mimetype, size: generatedPdfFile.size }
      : undefined;

    const created = await Onboarding.create({
      employeeName: body.name,
      role: "Employee",
      startDate: body.startDate,
      progress: Number.isFinite(Number(body.progress)) ? Number(body.progress) : 0,
      documentsUploaded: docs,
      documentsRequired: 4,
      approvalStatus: approval,
      w4FileName: w4File?.originalname || body.w4FileName || "",
      i9FileName: i9File?.originalname || body.i9FileName || "",
      signatureFileName: signatureFile?.originalname || body.signatureFileName || "",
      generatedPdfFileName: generatedPdfFile?.originalname || body.generatedPdfFileName || "",
      w4Attachment,
      i9Attachment,
      signatureAttachment,
      generatedPdfAttachment,
    });

    return res.status(201).json({ item: withId(created.toObject()) });
  } catch (err) {
    return next(err);
  }
});

router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const deleted = await Onboarding.findByIdAndDelete(req.params.id).lean();
    if (!deleted) return res.status(404).json({ error: { message: "Onboarding item not found" } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
