const express = require("express");
const { z } = require("zod");
const router = express.Router();
const LegalCase = require("../models/LegalCase");
const { requireAuth, requireRole } = require("../middleware/auth");

// Validation Schemas
const createSchema = z.object({
  title: z.string().min(1, "Title is required"),
  clientName: z.string().min(1, "Client Name is required"),
  type: z.string().min(1, "Case Type is required"),
  status: z.enum(["Open", "In Progress", "Pending Review", "Closed"]).optional().default("Open"),
  priority: z.enum(["Low", "Medium", "High", "Critical"]).optional().default("Medium"),
  court: z.string().optional().default(""),
  judge: z.string().optional().default(""),
  description: z.string().optional().default(""),
  openDate: z.string().optional().nullable(),
  closeDate: z.string().optional().nullable()
});

const updateSchema = createSchema.partial();

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

    const caseNumber = await generateCaseNumber();

    const created = await LegalCase.create({
      ...parsed.data,
      caseNumber,
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

    const updated = await LegalCase.findByIdAndUpdate(
      req.params.id, 
      { ...parsed.data, updatedBy: req.user?.id }, 
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
