const express = require("express");
const { z } = require("zod");

const Property = require("../models/Property");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

const createSchema = z.object({
  name: z.string().min(1, "Name is required"),
  street: z.string().optional().default(""),
  city: z.string().optional().default(""),
  state: z.string().optional().default(""),
  zip: z.string().optional().default(""),
  status: z.enum(["active", "inactive"]).optional().default("active"),
  notes: z.string().optional().default(""),
});

const updateSchema = createSchema.partial();

router.get("/", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const { search = "", status = "all" } = req.query;
    const query = {};

    const q = String(search || "").trim();
    if (q) {
      query.$or = [
        { name: { $regex: q, $options: "i" } },
        { street: { $regex: q, $options: "i" } },
        { city: { $regex: q, $options: "i" } },
        { state: { $regex: q, $options: "i" } },
        { zip: { $regex: q, $options: "i" } },
      ];
    }

    const st = String(status || "all");
    if (st !== "all") {
      query.status = st;
    }

    const items = await Property.find(query).sort({ createdAt: -1 }).lean();
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

router.get("/:id", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const item = await Property.findById(req.params.id).lean();
    if (!item) return res.status(404).json({ error: { message: "Property not found" } });
    res.json({ item });
  } catch (err) {
    next(err);
  }
});

router.post("/", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload", details: parsed.error.errors } });
    }

    const created = await Property.create(parsed.data);
    res.status(201).json({ item: created.toObject() });
  } catch (err) {
    next(err);
  }
});

router.patch("/:id", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload", details: parsed.error.errors } });
    }

    const updated = await Property.findByIdAndUpdate(req.params.id, parsed.data, { new: true }).lean();
    if (!updated) return res.status(404).json({ error: { message: "Property not found" } });

    res.json({ item: updated });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const deleted = await Property.findByIdAndDelete(req.params.id).lean();
    if (!deleted) return res.status(404).json({ error: { message: "Property not found" } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
