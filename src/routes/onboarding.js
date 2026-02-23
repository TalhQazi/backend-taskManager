const express = require("express");
const { z } = require("zod");

const Onboarding = require("../models/Onboarding");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

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
