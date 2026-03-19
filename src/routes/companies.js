const express = require("express");
const { z } = require("zod");

const Company = require("../models/Company");
const { createNotification } = require("../utils/notifications");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

// Helper function to generate prefix from company name (always 3-4 characters)
function generatePrefix(name) {
  if (!name || typeof name !== "string") return "XXX";
  
  // Remove special characters and split by spaces
  const cleanName = name.replace(/[^a-zA-Z0-9\s]/g, "");
  const words = cleanName.trim().split(/\s+/).filter(w => w.length > 0);
  
  if (words.length === 0) return "XXX";
  
  // If single word, take first 3 letters (or all if less than 3)
  if (words.length === 1) {
    const word = words[0];
    // Get first 3 letters, including numbers if present
    let prefix = "";
    for (let i = 0; i < Math.min(3, word.length); i++) {
      prefix += word.charAt(i).toUpperCase();
    }
    return prefix || "XXX";
  }
  
  // For multiple words, take first letter of first 3 words
  const prefix = words
    .slice(0, 3)
    .map(word => word.charAt(0).toUpperCase())
    .join("");
  
  return prefix || "XXX";
}

// Helper function to get next sequence number
async function getNextSequence() {
  const lastCompany = await Company.findOne().sort({ sequence: -1 }).lean();
  return lastCompany?.sequence ? lastCompany.sequence + 1 : 1;
}

// Helper function to generate company code
async function generateCompanyCode(name) {
  const prefix = generatePrefix(name);
  const sequence = await getNextSequence();
  const formattedSequence = String(sequence).padStart(3, "0");
  return { code: `${prefix}-${formattedSequence}`, sequence };
}

const createSchema = z.object({
  name: z.string().min(1, "Company name is required"),
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

// Create company (super-admin or admin)
router.post("/", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: parsed.error.errors[0]?.message || "Invalid payload" } });
    }

    // Auto-generate company code and sequence
    const { code, sequence } = await generateCompanyCode(parsed.data.name);

    // Check if generated code already exists (collision handling)
    let finalCode = code;
    let suffix = 0;
    while (await Company.findOne({ code: finalCode }).lean()) {
      suffix++;
      finalCode = `${code}-${suffix}`;
    }

    const created = await Company.create({
      ...parsed.data,
      code: finalCode,
      sequence,
      createdBy: req.user?.id,
    });

    // Create notification
    await createNotification({
      actor: req.user?.username || req.user?.name || "Admin",
      actorRole: req.user?.role || "admin",
      action: "created",
      resourceType: "company",
      resourceName: created.name,
      details: `Code: ${created.code}`,
      resourceId: String(created._id),
    });

    return res.status(201).json({ item: withId(created) });
  } catch (err) {
    return next(err);
  }
});

// Update company (super-admin or admin)
router.put("/:id", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
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

    // Create notification
    await createNotification({
      actor: req.user?.username || req.user?.name || "Admin",
      actorRole: req.user?.role || "admin",
      action: "updated",
      resourceType: "company",
      resourceName: updated.name,
      resourceId: String(req.params.id),
    });

    return res.json({ item: withId(updated) });
  } catch (err) {
    return next(err);
  }
});

// Delete company (super-admin or admin)
router.delete("/:id", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const deleted = await Company.findByIdAndDelete(req.params.id).lean();
    if (!deleted) {
      return res.status(404).json({ error: { message: "Company not found" } });
    }

    // Create notification
    await createNotification({
      actor: req.user?.username || req.user?.name || "Admin",
      actorRole: req.user?.role || "admin",
      action: "deleted",
      resourceType: "company",
      resourceName: deleted.name,
      resourceId: String(req.params.id),
    });

    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
