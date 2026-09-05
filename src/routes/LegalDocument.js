const express = require("express");
const { z } = require("zod");
const path = require("path");
const fs = require("fs");
const router = express.Router();
const LegalDocument = require("../models/LegalDocument");
const { requireAuth, requireRole } = require("../middleware/auth");
const { base64ToBuffer } = require("../lib/s3");

const createSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional().nullable().or(z.literal("")),
  fileType: z.string().min(1, "File Type is required"),
  caseReference: z.string().optional().nullable().or(z.literal("")),
  status: z.string().optional().nullable().or(z.literal("")),
  author: z.string().optional().nullable().or(z.literal("")),
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

async function generateNumber() {
  const count = await LegalDocument.countDocuments();
  const year = new Date().getFullYear();
  return `DOCUMENT-${year}-${String(count + 1).padStart(4, "0")}`;
}

function withId(doc) {
  if (!doc) return doc;
  const obj = doc.toObject ? doc.toObject() : doc;
  const { _id, __v, ...rest } = obj;
  return { ...rest, id: String(_id) };
}

router.get("/", requireAuth, async (req, res, next) => {
  try {
    const items = await LegalDocument.find().sort({ createdAt: -1 }).lean();
    res.json({ items: items.map(withId) });
  } catch (err) { next(err); }
});

router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const item = await LegalDocument.findById(req.params.id).lean();
    if (!item) return res.status(404).json({ error: { message: "Not found" } });
    res.json({ item: withId(item) });
  } catch (err) { next(err); }
});

router.post("/", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { message: parsed.error.errors[0]?.message || "Invalid payload" } });
    const documentNumber = await generateNumber();
    const processedAttachments = await processAttachments(parsed.data.attachments, "legal/documents");
    const created = await LegalDocument.create({ 
      ...parsed.data, 
      documentNumber, 
      attachments: processedAttachments,
      createdBy: req.user?.id 
    });
    res.status(201).json({ item: withId(created) });
  } catch (err) { next(err); }
});

router.put("/:id", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { message: parsed.error.errors[0]?.message || "Invalid payload" } });
    
    const processedAttachments = parsed.data.attachments ? await processAttachments(parsed.data.attachments, "legal/documents") : undefined;
    const updateData = { ...parsed.data };
    if (processedAttachments !== undefined) {
      updateData.attachments = processedAttachments;
    }
    
    const updated = await LegalDocument.findByIdAndUpdate(req.params.id, { ...updateData, updatedBy: req.user?.id }, { new: true }).lean();
    if (!updated) return res.status(404).json({ error: { message: "Not found" } });
    res.json({ item: withId(updated) });
  } catch (err) { next(err); }
});

router.delete("/:id", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const deleted = await LegalDocument.findByIdAndDelete(req.params.id).lean();
    if (!deleted) return res.status(404).json({ error: { message: "Not found" } });
    res.status(204).send();
  } catch (err) { next(err); }
});

module.exports = router;
