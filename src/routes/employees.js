const express = require("express");
const { z } = require("zod");

const Employee = require("../models/Employee");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().min(1),
  phone: z.string().optional().default(""),
  role: z.string().optional().default(""),
  department: z.string().optional().default(""),
  location: z.string().optional().default(""),
  status: z.enum(["active", "away", "offline"]).optional(),
  joinDate: z.union([z.string(), z.date()]).optional(),
});

const updateSchema = createSchema.partial();

function withId(doc) {
  if (!doc) return doc;
  return { ...doc, id: String(doc._id) };
}

router.get("/", requireAuth, async (_req, res, next) => {
  try {
    const items = await Employee.find().sort({ createdAt: -1 }).lean();
    res.json({ items: items.map(withId) });
  } catch (err) {
    next(err);
  }
});

router.post("/", requireAuth, async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload" } });
    }

    const joinDate = parsed.data.joinDate ? new Date(parsed.data.joinDate) : undefined;

    const created = await Employee.create({
      ...parsed.data,
      joinDate,
    });

    const obj = created.toObject();
    return res.status(201).json({ item: withId(obj) });
  } catch (err) {
    return next(err);
  }
});

router.put("/:id", requireAuth, async (req, res, next) => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload" } });
    }

    const patch = { ...parsed.data };
    if (patch.joinDate) {
      patch.joinDate = new Date(patch.joinDate);
    }

    const updated = await Employee.findByIdAndUpdate(req.params.id, patch, {
      new: true,
    }).lean();

    if (!updated) {
      return res.status(404).json({ error: { message: "Employee not found" } });
    }

    return res.json({ item: withId(updated) });
  } catch (err) {
    return next(err);
  }
});

router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const deleted = await Employee.findByIdAndDelete(req.params.id).lean();
    if (!deleted) {
      return res.status(404).json({ error: { message: "Employee not found" } });
    }
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
