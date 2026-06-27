const express = require("express");
const { z } = require("zod");
const router = express.Router();
const LegalEvidence = require("../models/LegalEvidence");
const { requireAuth, requireRole } = require("../middleware/auth");

const createSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional().nullable().or(z.literal("")),
  evidenceType: z.string().min(1, "Evidence Type is required"),
  dateAcquired: z.string().optional().nullable().or(z.literal("")),
  location: z.string().optional().nullable().or(z.literal("")),
  caseReference: z.string().optional().nullable().or(z.literal("")),
  status: z.string().optional().nullable().or(z.literal(""))
});
const updateSchema = createSchema.partial();

async function generateNumber() {
  const count = await LegalEvidence.countDocuments();
  const year = new Date().getFullYear();
  return `EVIDENCE-${year}-${String(count + 1).padStart(4, "0")}`;
}

function withId(doc) {
  if (!doc) return doc;
  const obj = doc.toObject ? doc.toObject() : doc;
  const { _id, __v, ...rest } = obj;
  return { ...rest, id: String(_id) };
}

router.get("/", requireAuth, async (req, res, next) => {
  try {
    const items = await LegalEvidence.find().sort({ createdAt: -1 }).lean();
    res.json({ items: items.map(withId) });
  } catch (err) { next(err); }
});

router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const item = await LegalEvidence.findById(req.params.id).lean();
    if (!item) return res.status(404).json({ error: { message: "Not found" } });
    res.json({ item: withId(item) });
  } catch (err) { next(err); }
});

router.post("/", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { message: parsed.error.errors[0]?.message || "Invalid payload" } });
    const evidenceNumber = await generateNumber();
    const created = await LegalEvidence.create({ ...parsed.data, evidenceNumber, createdBy: req.user?.id });
    res.status(201).json({ item: withId(created) });
  } catch (err) { next(err); }
});

router.put("/:id", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { message: parsed.error.errors[0]?.message || "Invalid payload" } });
    const updated = await LegalEvidence.findByIdAndUpdate(req.params.id, { ...parsed.data, updatedBy: req.user?.id }, { new: true }).lean();
    if (!updated) return res.status(404).json({ error: { message: "Not found" } });
    res.json({ item: withId(updated) });
  } catch (err) { next(err); }
});

router.delete("/:id", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const deleted = await LegalEvidence.findByIdAndDelete(req.params.id).lean();
    if (!deleted) return res.status(404).json({ error: { message: "Not found" } });
    res.status(204).send();
  } catch (err) { next(err); }
});

module.exports = router;
