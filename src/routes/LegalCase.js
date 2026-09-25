const express = require("express");
const { z } = require("zod");
const path = require("path");
const fs = require("fs");
const router = express.Router();
const LegalCase = require("../models/LegalCase");
const { requireAuth, requireRole } = require("../middleware/auth");
const { base64ToBuffer } = require("../lib/s3");

// Validation Schemas
const createSchema = z.object({
  caseNumber: z.string().optional(),
  title: z.string().min(1, "Title is required"),
  clientName: z.string().min(1, "Client Name is required"),
  type: z.string().min(1, "Case Type is required"),
  status: z.enum(["Open", "In Progress", "Pending Review", "Closed"]).optional().default("Open"),
  priority: z.enum(["Low", "Medium", "High", "Critical"]).optional().default("Medium"),
  court: z.string().optional().default(""),
  judge: z.string().optional().default(""),
  originatingCaseNumber: z.string().optional().default(""),
  originatingCourt: z.string().optional().default(""),
  judges: z.array(z.string()).optional().default([]),
  description: z.string().optional().default(""),
  openDate: z.string().optional().nullable(),
  closeDate: z.string().optional().nullable(),
  attachments: z.array(z.object({
    fileName: z.string().optional().nullable(),
    url: z.string().optional().nullable(),
    mimeType: z.string().optional().nullable(),
    size: z.number().optional().nullable(),
    uploadedAt: z.union([z.date(), z.string()]).optional().nullable()
  })).optional()
});

const updateSchema = createSchema.partial();

async function saveFileLocally(buffer, originalName, folder) {
  const fileExtension = path.extname(originalName);
  const uniqueName = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}${fileExtension}`;
  
  const destPath = path.join(__dirname, "../../uploads", folder, uniqueName);
  await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
  await fs.promises.writeFile(destPath, buffer);
  
  return `/uploads/${folder}/${uniqueName}`;
}

async function processAttachments(attachments, folder) {
  if (!Array.isArray(attachments) || attachments.length === 0) return [];
  return Promise.all(attachments.map(async (att) => {
    if (att.url && att.url.startsWith("data:")) {
      try {
        const { buffer, mimeType } = base64ToBuffer(att.url);
        const localUrl = await saveFileLocally(buffer, att.fileName || "attachment", folder);
        return {
          fileName: att.fileName || "attachment",
          url: localUrl,
          mimeType: att.mimeType || mimeType,
          size: att.size || buffer.length,
          uploadedAt: new Date()
        };
      } catch (err) {
        console.error("Failed to save attachment locally:", err);
        return att;
      }
    }
    return att;
  }));
}

// Helper to generate a unique case number
async function generateCaseNumber() {
  const count = await LegalCase.countDocuments();
  const year = new Date().getFullYear();
  return `CASE-${year}-${String(count + 1).padStart(4, "0")}`;
}

function withId(doc) {
  if (!doc) return doc;
  const obj = doc.toObject ? doc.toObject() : doc;
  const { _id, __v, ...rest } = obj;
  return { ...rest, id: String(_id) };
}

// GET all cases
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const items = await LegalCase.find().sort({ createdAt: -1 }).lean();
    res.json({ items: items.map(withId) });
  } catch (err) {
    next(err);
  }
});

// GET case by ID
router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const item = await LegalCase.findById(req.params.id).lean();
    if (!item) return res.status(404).json({ error: { message: "Case not found" } });
    res.json({ item: withId(item) });
  } catch (err) {
    next(err);
  }
});

// POST new case
router.post("/", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: parsed.error.errors[0]?.message || "Invalid payload" } });
    }

    const caseNumber = parsed.data.caseNumber || await generateCaseNumber();
    const processedAttachments = await processAttachments(parsed.data.attachments, "legal/cases");

    const created = await LegalCase.create({
      ...parsed.data,
      caseNumber,
      attachments: processedAttachments,
      createdBy: req.user?.id,
    });

    res.status(201).json({ item: withId(created) });
  } catch (err) {
    next(err);
  }
});

// PUT update case
router.put("/:id", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: parsed.error.errors[0]?.message || "Invalid payload" } });
    }

    const processedAttachments = parsed.data.attachments ? await processAttachments(parsed.data.attachments, "legal/cases") : undefined;
    const updateData = { ...parsed.data };
    if (processedAttachments !== undefined) {
      updateData.attachments = processedAttachments;
    }

    const updated = await LegalCase.findByIdAndUpdate(
      req.params.id, 
      { ...updateData, updatedBy: req.user?.id }, 
      { new: true }
    ).lean();

    if (!updated) return res.status(404).json({ error: { message: "Case not found" } });
    res.json({ item: withId(updated) });
  } catch (err) {
    next(err);
  }
});

// DELETE case
router.delete("/:id", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const deleted = await LegalCase.findByIdAndDelete(req.params.id).lean();
    if (!deleted) return res.status(404).json({ error: { message: "Case not found" } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
