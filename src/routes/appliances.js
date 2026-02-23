const express = require("express");
const { z } = require("zod");

const Appliance = require("../models/Appliance");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const createSchema = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
  serialNumber: z.string().min(1),
  status: z.enum(["operational", "needs-repair", "out-of-service"]).optional(),
  location: z.string().min(1),
  warrantyExpiry: z.string().optional().default(""),
  lastMaintenance: z.string().optional().default(""),
  assignedTo: z.string().optional().nullable(),
});

const updateSchema = createSchema.partial();

router.get("/", requireAuth, async (_req, res, next) => {
  try {
    const items = await Appliance.find().sort({ createdAt: -1 }).lean();
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

router.post("/", requireAuth, async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { message: "Invalid payload" } });

    const created = await Appliance.create(parsed.data);
    res.status(201).json({ item: created.toObject() });
  } catch (err) {
    next(err);
  }
});

router.put("/:id", requireAuth, async (req, res, next) => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { message: "Invalid payload" } });

    const updated = await Appliance.findByIdAndUpdate(req.params.id, parsed.data, { new: true }).lean();
    if (!updated) return res.status(404).json({ error: { message: "Appliance not found" } });

    res.json({ item: updated });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const deleted = await Appliance.findByIdAndDelete(req.params.id).lean();
    if (!deleted) return res.status(404).json({ error: { message: "Appliance not found" } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
