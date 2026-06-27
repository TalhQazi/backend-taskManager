const express = require("express");
const { z } = require("zod");
const router = express.Router();
const LegalCourt = require("../models/LegalCourt");
const { requireAuth, requireRole } = require("../middleware/auth");

const createSchema = z.object({
  name: z.string().min(1, "Court name is required"),
  description: z.string().optional().default("")
});

function withId(doc) {
  if (!doc) return doc;
  const obj = doc.toObject ? doc.toObject() : doc;
  const { _id, __v, ...rest } = obj;
  return { ...rest, id: String(_id) };
}

// GET all courts
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const items = await LegalCourt.find().sort({ name: 1 }).lean();
    res.json({ items: items.map(withId) });
  } catch (err) {
    next(err);
  }
});

// POST new court
router.post("/", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: parsed.error.errors[0]?.message || "Invalid payload" } });
    }

    const exists = await LegalCourt.findOne({ name: parsed.data.name }).collation({ locale: 'en', strength: 2 }).lean();
    if (exists) {
      return res.status(400).json({ error: { message: "A court with this name already exists" } });
    }

    const created = await LegalCourt.create({
      ...parsed.data,
      createdBy: req.user?.id,
    });

    res.status(201).json({ item: withId(created) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
