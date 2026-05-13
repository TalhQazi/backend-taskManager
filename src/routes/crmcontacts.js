const express = require("express");
const { z } = require("zod");

const CRMContact = require("../models/CRMContact");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

const createSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email format"),
  phone: z.string().min(1, "Phone number is required"),
  company: z.string().min(1, "Company is required"),
  status: z.enum(["Active", "Pending", "Inactive"]).optional().default("Active"),
});

const updateSchema = createSchema.partial();

function withId(doc) {
  if (!doc) return doc;
  const obj = doc.toObject ? doc.toObject() : doc;
  const { _id, __v, ...rest } = obj;
  return { ...rest, id: String(_id) };
}

// Get all CRM contacts with search and filters
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const { search, status } = req.query;
    
    let query = {};
    
    // Search filter
    if (search) {
      const searchRegex = new RegExp(search, "i");
      query.$or = [
        { name: searchRegex },
        { email: searchRegex },
        { phone: searchRegex },
        { company: searchRegex },
      ];
    }
    
    // Status filter
    if (status && status !== "All") {
      query.status = status;
    }
    
    const items = await CRMContact.find(query).sort({ createdAt: -1 }).lean();
    res.json({ items: items.map(withId) });
  } catch (err) {
    next(err);
  }
});

// Get CRM contact by ID
router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const item = await CRMContact.findById(req.params.id).lean();
    if (!item) {
      return res.status(404).json({ error: { message: "CRM contact not found" } });
    }
    res.json({ item: withId(item) });
  } catch (err) {
    next(err);
  }
});

// Create CRM contact
router.post("/", requireAuth, async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: parsed.error.errors[0]?.message || "Invalid payload" } });
    }

    const created = await CRMContact.create({
      ...parsed.data,
      createdBy: req.user?.id,
    });

    return res.status(201).json({ item: withId(created) });
  } catch (err) {
    return next(err);
  }
});

// Update CRM contact
router.put("/:id", requireAuth, async (req, res, next) => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: parsed.error.errors[0]?.message || "Invalid payload" } });
    }

    const patch = { ...parsed.data, updatedBy: req.user?.id };

    const updated = await CRMContact.findByIdAndUpdate(req.params.id, patch, {
      new: true,
    }).lean();

    if (!updated) {
      return res.status(404).json({ error: { message: "CRM contact not found" } });
    }

    return res.json({ item: withId(updated) });
  } catch (err) {
    return next(err);
  }
});

// Delete CRM contact
router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const deleted = await CRMContact.findByIdAndDelete(req.params.id).lean();
    if (!deleted) {
      return res.status(404).json({ error: { message: "CRM contact not found" } });
    }

    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
