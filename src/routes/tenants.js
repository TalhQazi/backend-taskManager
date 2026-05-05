const express = require("express");
const { z } = require("zod");

const Tenant = require("../models/Tenant");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

const createSchema = z.object({
  name: z.preprocess(
    (v) => (typeof v === "string" ? v : v == null ? "" : String(v)),
    z.string().min(1, "Name is required")
  ),
  email: z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
    z.union([z.string().email(), z.literal("")])
  ).optional().default(""),
  phone: z.preprocess(
    (v) => (typeof v === "string" ? v : v == null ? "" : String(v)),
    z.string()
  ).optional().default(""),
  address: z.preprocess(
    (v) => (typeof v === "string" ? v : v == null ? "" : String(v)),
    z.string()
  ).optional().default(""),
  amount: z.preprocess(
    (v) => {
      if (v === "" || v === null || v === undefined) return undefined;
      if (typeof v === "number") return v;
      if (typeof v === "string") {
        const n = Number(v);
        return Number.isFinite(n) ? n : v;
      }
      return v;
    },
    z.number()
  ).optional().default(0),
  status: z.enum(["active", "inactive"]).optional().default("active"),
  notes: z.preprocess(
    (v) => (typeof v === "string" ? v : v == null ? "" : String(v)),
    z.string()
  ).optional().default(""),
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
        { email: { $regex: q, $options: "i" } },
      ];
    }

    const st = String(status || "all");
    if (st !== "all") {
      query.status = st;
    }

    const items = await Tenant.find(query).sort({ createdAt: -1 }).lean();
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

router.get("/:id", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const item = await Tenant.findById(req.params.id).lean();
    if (!item) return res.status(404).json({ error: { message: "Tenant not found" } });
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

    const created = await Tenant.create(parsed.data);
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

    const updated = await Tenant.findByIdAndUpdate(req.params.id, parsed.data, { new: true }).lean();
    if (!updated) return res.status(404).json({ error: { message: "Tenant not found" } });

    res.json({ item: updated });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const deleted = await Tenant.findByIdAndDelete(req.params.id).lean();
    if (!deleted) return res.status(404).json({ error: { message: "Tenant not found" } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
