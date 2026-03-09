const express = require("express");
const { z } = require("zod");

const Company = require("../models/Company");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

const createSchema = z.object({
  name: z.string().min(1, "Company name is required"),
  code: z.string().min(1, "Company code is required"),
  description: z.string().optional().default(""),
  address: z.object({
    street: z.string().optional().default(""),
    city: z.string().optional().default(""),
    state: z.string().optional().default(""),
    zipCode: z.string().optional().default(""),
    country: z.string().optional().default(""),
  }).optional().default({}),
  contact: z.object({
    email: z.string().optional().default(""),
    phone: z.string().optional().default(""),
    website: z.string().optional().default(""),
  }).optional().default({}),
  status: z.enum(["active", "inactive", "suspended"]).optional().default("active"),
  settings: z.object({
    timezone: z.string().optional().default("UTC"),
    dateFormat: z.string().optional().default("MM/DD/YYYY"),
    currency: z.string().optional().default("USD"),
  }).optional().default({}),
  logo: z.string().optional().default(""),
});

const updateSchema = createSchema.partial();

function withId(doc) {
  if (!doc) return doc;
  const obj = doc.toObject ? doc.toObject() : doc;
  const { _id, __v, ...rest } = obj;
  return { ...rest, id: String(_id) };
}

// Get all companies
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const items = await Company.find().sort({ createdAt: -1 }).lean();
    res.json({ items: items.map(withId) });
  } catch (err) {
    next(err);
  }
});

// Get company by ID
router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const item = await Company.findById(req.params.id).lean();
    if (!item) {
      return res.status(404).json({ error: { message: "Company not found" } });
    }
    res.json({ item: withId(item) });
  } catch (err) {
    next(err);
  }
});

// Create company (super-admin only)
router.post("/", requireAuth, requireRole(["super-admin"]), async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: parsed.error.errors[0]?.message || "Invalid payload" } });
    }

    // Check if code already exists
    const existing = await Company.findOne({ code: parsed.data.code.toUpperCase() }).lean();
    if (existing) {
      return res.status(409).json({ error: { message: "Company code already exists" } });
    }

    const created = await Company.create({
      ...parsed.data,
      code: parsed.data.code.toUpperCase(),
      createdBy: req.user?.id,
    });

    return res.status(201).json({ item: withId(created) });
  } catch (err) {
    return next(err);
  }
});

// Update company (super-admin only)
router.put("/:id", requireAuth, requireRole(["super-admin"]), async (req, res, next) => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: parsed.error.errors[0]?.message || "Invalid payload" } });
    }

    const patch = { ...parsed.data, updatedBy: req.user?.id };

    // If code is being updated, check for uniqueness
    if (patch.code) {
      const existing = await Company.findOne({
        code: patch.code.toUpperCase(),
        _id: { $ne: req.params.id },
      }).lean();
      if (existing) {
        return res.status(409).json({ error: { message: "Company code already exists" } });
      }
      patch.code = patch.code.toUpperCase();
    }

    const updated = await Company.findByIdAndUpdate(req.params.id, patch, {
      new: true,
    }).lean();

    if (!updated) {
      return res.status(404).json({ error: { message: "Company not found" } });
    }

    return res.json({ item: withId(updated) });
  } catch (err) {
    return next(err);
  }
});

// Delete company (super-admin only)
router.delete("/:id", requireAuth, requireRole(["super-admin"]), async (req, res, next) => {
  try {
    const deleted = await Company.findByIdAndDelete(req.params.id).lean();
    if (!deleted) {
      return res.status(404).json({ error: { message: "Company not found" } });
    }
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
