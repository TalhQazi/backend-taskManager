const express = require("express");
const { z } = require("zod");

const DoNotHire = require("../models/DoNotHire");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

function withId(doc) {
  if (!doc) return doc;
  return { ...doc, id: String(doc._id) };
}

const adminUiSchema = z.object({
  name: z.string().min(1),
  reason: z.string().min(1),
  incidentNotes: z.string().optional().default(""),
  addedAt: z.string().min(1),
  status: z.string().optional(),
});

const createSchema = z.object({
  fullName: z.string().min(1),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  reason: z.string().min(1),
  incidentNotes: z.string().min(1),
  createdAt: z.string().min(1),
});

const updateSchema = createSchema.partial();

router.get("/", requireAuth, async (_req, res, next) => {
  try {
    const items = await DoNotHire.find().sort({ createdAt: -1 }).lean();
    res.json({ items: items.map(withId) });
  } catch (err) {
    next(err);
  }
});

router.post("/", requireAuth, async (req, res, next) => {
  try {
    const adminParsed = adminUiSchema.safeParse(req.body);
    if (adminParsed.success) {
      const created = await DoNotHire.create({
        fullName: adminParsed.data.name,
        phone: null,
        email: null,
        reason: adminParsed.data.reason,
        incidentNotes: adminParsed.data.incidentNotes,
        createdAt: adminParsed.data.addedAt,
      });
      return res.status(201).json({ item: withId(created.toObject()) });
    }

    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { message: "Invalid payload" } });

    const created = await DoNotHire.create(parsed.data);
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
      if (typeof adminParsed.data.name === "string") patch.fullName = adminParsed.data.name;
      if (typeof adminParsed.data.reason === "string") patch.reason = adminParsed.data.reason;
      if (typeof adminParsed.data.incidentNotes === "string") patch.incidentNotes = adminParsed.data.incidentNotes;
      if (typeof adminParsed.data.addedAt === "string") patch.createdAt = adminParsed.data.addedAt;

      const updated = await DoNotHire.findByIdAndUpdate(req.params.id, patch, { new: true }).lean();
      if (!updated) return res.status(404).json({ error: { message: "Entry not found" } });
      return res.json({ item: withId(updated) });
    }

    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { message: "Invalid payload" } });

    const updated = await DoNotHire.findByIdAndUpdate(req.params.id, parsed.data, { new: true }).lean();
    if (!updated) return res.status(404).json({ error: { message: "Entry not found" } });

    res.json({ item: withId(updated) });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const deleted = await DoNotHire.findByIdAndDelete(req.params.id).lean();
    if (!deleted) return res.status(404).json({ error: { message: "Entry not found" } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
