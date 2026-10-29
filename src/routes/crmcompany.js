const express = require("express");
const { z } = require("zod");

const CRMCompany = require("../models/CRMCompany");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

const createSchema = z.object({
  name: z.string().min(1, "Company name is required"),
  industry: z.enum(["Technology", "Finance", "Healthcare", "Retail", "Manufacturing", "Logistics", "Other"]),
  contactCount: z.number().min(0).optional().default(0),
  activeDeals: z.number().min(0).optional().default(0),
  status: z.enum(["Active", "Prospect", "Inactive"]).optional().default("Active"),
  website: z.string().optional().default(""),
  location: z.string().optional().default(""),
  description: z.string().optional().default(""),
});

const updateSchema = createSchema.partial();

function withId(doc) {
  if (!doc) return doc;
  const obj = doc.toObject ? doc.toObject() : doc;
  const { _id, __v, ...rest } = obj;
  return { ...rest, id: String(_id) };
}

// Get all CRM companies with search and filters
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const { search, status, industry } = req.query;
    
    let query = {};
    
    // Search filter
    if (search) {
      const searchRegex = new RegExp(search, "i");
      query.$or = [
        { name: searchRegex },
        { industry: searchRegex },
        { website: searchRegex },
      ];
    }
    
    // Status filter
    if (status && status !== "All") {
      query.status = status;
    }
    
    // Industry filter
    if (industry && industry !== "All") {
      query.industry = industry;
    }
    
    const items = await CRMCompany.find(query).sort({ createdAt: -1 }).lean();
    res.json({ items: items.map(withId) });
  } catch (err) {
    next(err);
  }
});

// Get CRM company by ID
router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const item = await CRMCompany.findById(req.params.id).lean();
    if (!item) {
      return res.status(404).json({ error: { message: "CRM company not found" } });
    }
    res.json({ item: withId(item) });
  } catch (err) {
    next(err);
  }
});

// Create CRM company
router.post("/", requireAuth, async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: parsed.error.errors[0]?.message || "Invalid payload" } });
    }

    const created = await CRMCompany.create({
      ...parsed.data,
      createdBy: req.user?.id,
    });

    return res.status(201).json({ item: withId(created) });
  } catch (err) {
    return next(err);
  }
});

// Update CRM company
router.put("/:id", requireAuth, async (req, res, next) => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: parsed.error.errors[0]?.message || "Invalid payload" } });
    }

    const patch = { ...parsed.data, updatedBy: req.user?.id };

    const updated = await CRMCompany.findByIdAndUpdate(req.params.id, patch, {
      new: true,
    }).lean();

    if (!updated) {
      return res.status(404).json({ error: { message: "CRM company not found" } });
    }

    return res.json({ item: withId(updated) });
  } catch (err) {
    return next(err);
  }
});

// Delete CRM company
router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const deleted = await CRMCompany.findByIdAndDelete(req.params.id).lean();
    if (!deleted) {
      return res.status(404).json({ error: { message: "CRM company not found" } });
    }

    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
