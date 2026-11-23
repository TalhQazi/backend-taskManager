const express = require("express");
const CompanyLocation = require("../models/CompanyLocation");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

// Get all company locations (with optional ?company=<id> filter)
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.company) filter.company = req.query.company;
    if (req.query.active === "true") filter.isActive = true;

    const items = await CompanyLocation.find(filter)
      .populate("company", "name code")
      .sort({ company: 1, isPrimary: -1, label: 1 })
      .lean();

    res.json({ items });
  } catch (err) {
    next(err);
  }
});

// Get single company location
router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const item = await CompanyLocation.findById(req.params.id)
      .populate("company", "name code")
      .lean();

    if (!item) {
      return res.status(404).json({ error: { message: "Company location not found" } });
    }

    res.json({ item });
  } catch (err) {
    next(err);
  }
});

// Create company location (admin/super-admin)
router.post("/", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const { company, label, address, isPrimary, isActive, notes } = req.body;

    if (!company) {
      return res.status(400).json({ error: { message: "company is required" } });
    }
    if (!label || !label.trim()) {
      return res.status(400).json({ error: { message: "label is required (e.g. 'Main Office', 'NJ Branch')" } });
    }

    // If marking as primary, unset primary on other locations for this company
    if (isPrimary) {
      await CompanyLocation.updateMany(
        { company, isPrimary: true },
        { $set: { isPrimary: false } }
      );
    }

    const item = await CompanyLocation.create({
      company,
      label: label.trim(),
      address: address || {},
      isPrimary: isPrimary || false,
      isActive: isActive !== false,
      notes: notes || "",
    });

    const populated = await CompanyLocation.findById(item._id)
      .populate("company", "name code")
      .lean();

    res.status(201).json({ item: populated });
  } catch (err) {
    next(err);
  }
});

// Update company location (admin/super-admin)
router.put("/:id", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const { company, label, address, isPrimary, isActive, notes } = req.body;

    // If marking as primary, unset primary on other locations for this company
    if (isPrimary) {
      const existing = await CompanyLocation.findById(req.params.id).lean();
      if (existing) {
        await CompanyLocation.updateMany(
          { company: company || existing.company, isPrimary: true, _id: { $ne: req.params.id } },
          { $set: { isPrimary: false } }
        );
      }
    }

    const patch = {};
    if (company !== undefined) patch.company = company;
    if (label !== undefined) patch.label = label.trim();
    if (address !== undefined) patch.address = address;
    if (isPrimary !== undefined) patch.isPrimary = isPrimary;
    if (isActive !== undefined) patch.isActive = isActive;
    if (notes !== undefined) patch.notes = notes;

    const updated = await CompanyLocation.findByIdAndUpdate(
      req.params.id,
      { $set: patch },
      { new: true }
    )
      .populate("company", "name code")
      .lean();

    if (!updated) {
      return res.status(404).json({ error: { message: "Company location not found" } });
    }

    res.json({ item: updated });
  } catch (err) {
    next(err);
  }
});

// Delete company location (admin/super-admin)
router.delete("/:id", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const deleted = await CompanyLocation.findByIdAndDelete(req.params.id).lean();
    if (!deleted) {
      return res.status(404).json({ error: { message: "Company location not found" } });
    }
    res.json({ message: "Company location deleted successfully" });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
