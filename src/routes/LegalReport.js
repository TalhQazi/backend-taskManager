const express = require("express");
const { z } = require("zod");
const router = express.Router();
const LegalReport = require("../models/LegalReport");
const { requireAuth, requireRole } = require("../middleware/auth");

const createSchema = z.object({
  title: z.string().min(1, "Report Title is required"),\n  description: z.string().optional().nullable().or(z.literal("")),\n  reportType: z.string().optional().nullable().or(z.literal("")),\n  generatedBy: z.string().optional().nullable().or(z.literal("")),\n  dateGenerated: z.string().optional().nullable().or(z.literal(""))
});
const updateSchema = createSchema.partial();

async function generateNumber() {
  const count = await LegalReport.countDocuments();
  const year = new Date().getFullYear();
  return `REPORT-${year}-${String(count + 1).padStart(4, "0")}`;
}

function withId(doc) {
  if (!doc) return doc;
  const obj = doc.toObject ? doc.toObject() : doc;
  const { _id, __v, ...rest } = obj;
  return { ...rest, id: String(_id) };
}

router.get("/", requireAuth, async (req, res, next) => {
  try {
    const items = await LegalReport.find().sort({ createdAt: -1 }).lean();
    res.json({ items: items.map(withId) });
  } catch (err) { next(err); }
});

router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const item = await LegalReport.findById(req.params.id).lean();
    if (!item) return res.status(404).json({ error: { message: "Not found" } });
    res.json({ item: withId(item) });
  } catch (err) { next(err); }
});

router.post("/", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { message: parsed.error.errors[0]?.message || "Invalid payload" } });
    const reportNumber = await generateNumber();
    const created = await LegalReport.create({ ...parsed.data, reportNumber, createdBy: req.user?.id });
    res.status(201).json({ item: withId(created) });
  } catch (err) { next(err); }
});

router.put("/:id", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { message: parsed.error.errors[0]?.message || "Invalid payload" } });
    const updated = await LegalReport.findByIdAndUpdate(req.params.id, { ...parsed.data, updatedBy: req.user?.id }, { new: true }).lean();
    if (!updated) return res.status(404).json({ error: { message: "Not found" } });
    res.json({ item: withId(updated) });
  } catch (err) { next(err); }
});

router.delete("/:id", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const deleted = await LegalReport.findByIdAndDelete(req.params.id).lean();
    if (!deleted) return res.status(404).json({ error: { message: "Not found" } });
    res.status(204).send();
  } catch (err) { next(err); }
});

module.exports = router;
