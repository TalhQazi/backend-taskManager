const express = require("express");
const { z } = require("zod");
const VendorCategory = require("../models/VendorCategory");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const categorySchema = z.object({
  name: z.string().min(1, "Name is required"),
});

// GET all categories
router.get("/", requireAuth, async (req, res, next) => {
  try {
    let items = await VendorCategory.find().sort({ name: 1 }).lean();
    
    // Seed default categories if none exist
    if (items.length === 0) {
      const defaults = [
        "Plumbing", "Electrical", "HVAC", "Landscaping", 
        "Cleaning", "Roofing", "Pest Control", "Painting"
      ];
      await VendorCategory.insertMany(defaults.map(name => ({ name })));
      items = await VendorCategory.find().sort({ name: 1 }).lean();
    }
    
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

// POST create category
router.post("/", requireAuth, async (req, res, next) => {
  try {
    const parsed = categorySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ 
        error: { message: "Invalid payload", details: parsed.error.errors } 
      });
    }

    const created = await VendorCategory.create(parsed.data);
    res.status(201).json({ item: created.toObject() });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ error: { message: "Category already exists" } });
    }
    next(err);
  }
});

// DELETE category
router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    await VendorCategory.findByIdAndDelete(req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
