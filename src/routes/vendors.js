const express = require("express");
const { z } = require("zod");
const Vendor = require("../models/Vendor");
const { createNotification } = require("../utils/notifications");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const vendorSchema = z.object({
  name: z.string().min(1, "Name is required"),
  phone: z.string().min(1, "Phone is required"),
  email: z.union([z.string().email(), z.literal("")]).optional().default(""),
  street: z.string().optional().default(""),
  city: z.string().optional().default(""),
  state: z.string().optional().default(""),
  zip: z.string().optional().default(""),
  website: z.string().optional().default(""),
  serviceType: z.string().min(1, "Service type is required"),
  location: z.string().min(1, "Location is required"),
  status: z.enum(["approved", "not-approved"]).optional().default("approved"),
  notes: z.string().optional().default(""),
});

const updateSchema = vendorSchema.partial();

// GET all vendors (with optional location filter)
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const { location } = req.query;
    const query = location ? { location } : {};
    const items = await Vendor.find(query).sort({ createdAt: -1 }).lean();
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

// GET single vendor
router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const vendor = await Vendor.findById(req.params.id).lean();
    if (!vendor) return res.status(404).json({ error: { message: "Vendor not found" } });
    res.json({ item: vendor });
  } catch (err) {
    next(err);
  }
});

// POST create vendor
router.post("/", requireAuth, async (req, res, next) => {
  try {
    const parsed = vendorSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ 
        error: { 
          message: "Invalid payload", 
          details: parsed.error.errors 
        } 
      });
    }

    const created = await Vendor.create(parsed.data);
    
    // Create notification
    await createNotification({
      actor: req.user?.name || req.user?.username || "Admin",
      actorRole: req.user?.role || "admin",
      action: "created",
      resourceType: "vendor",
      resourceName: created.name,
      details: created.serviceType ? `Service: ${created.serviceType}` : "",
      resourceId: String(created._id),
    });
    
    res.status(201).json({ item: created.toObject() });
  } catch (err) {
    next(err);
  }
});

// PUT update vendor
router.put("/:id", requireAuth, async (req, res, next) => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ 
        error: { 
          message: "Invalid payload", 
          details: parsed.error.errors 
        } 
      });
    }

    const updated = await Vendor.findByIdAndUpdate(
      req.params.id, 
      parsed.data, 
      { new: true }
    ).lean();
    
    if (!updated) return res.status(404).json({ error: { message: "Vendor not found" } });

    // Create notification
    await createNotification({
      actor: req.user?.name || req.user?.username || "Admin",
      actorRole: req.user?.role || "admin",
      action: "updated",
      resourceType: "vendor",
      resourceName: updated.name,
      details: parsed.data.status ? `Status: ${parsed.data.status}` : "",
      resourceId: String(req.params.id),
    });

    res.json({ item: updated });
  } catch (err) {
    next(err);
  }
});

// DELETE vendor
router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const deleted = await Vendor.findByIdAndDelete(req.params.id).lean();
    if (!deleted) return res.status(404).json({ error: { message: "Vendor not found" } });
    
    // Create notification
    await createNotification({
      actor: req.user?.name || req.user?.username || "Admin",
      actorRole: req.user?.role || "admin",
      action: "deleted",
      resourceType: "vendor",
      resourceName: deleted.name,
      resourceId: String(req.params.id),
    });
    
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
