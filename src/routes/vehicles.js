const express = require("express");
const { z } = require("zod");

const Vehicle = require("../models/Vehicle");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const createSchema = z.object({
  name: z.string().min(1),
  type: z.string().optional().default(""),
  licensePlate: z.string().min(1),
  status: z.enum(["available", "in-use", "maintenance"]).optional(),
  assignedTo: z.string().nullable().optional(),
  fuelLevel: z.number().min(0).max(100).optional(),
  mileage: z.number().min(0).optional(),
  lastInspection: z.union([z.string(), z.date()]).optional(),
  nextInspection: z.union([z.string(), z.date()]).optional(),
});

const updateSchema = createSchema.partial();

function withId(doc) {
  if (!doc) return doc;
  return { ...doc, id: String(doc._id) };
}

router.get("/", requireAuth, async (_req, res, next) => {
  try {
    const items = await Vehicle.find().sort({ createdAt: -1 }).lean();
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

    const created = await Vehicle.create({
      ...parsed.data,
      lastInspection: parsed.data.lastInspection ? new Date(parsed.data.lastInspection) : undefined,
      nextInspection: parsed.data.nextInspection ? new Date(parsed.data.nextInspection) : undefined,
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
    if (patch.lastInspection) patch.lastInspection = new Date(patch.lastInspection);
    if (patch.nextInspection) patch.nextInspection = new Date(patch.nextInspection);

    const updated = await Vehicle.findByIdAndUpdate(req.params.id, patch, {
      new: true,
    }).lean();

    if (!updated) {
      return res.status(404).json({ error: { message: "Vehicle not found" } });
    }

    return res.json({ item: withId(updated) });
  } catch (err) {
    return next(err);
  }
});

router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const deleted = await Vehicle.findByIdAndDelete(req.params.id).lean();
    if (!deleted) {
      return res.status(404).json({ error: { message: "Vehicle not found" } });
    }
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
