const express = require("express");
const { z } = require("zod");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const Appliance = require("../models/Appliance");
const AssetSequence = require("../models/AssetSequence");
const Vehicle = require("../models/Vehicle");
const ActivityLog = require("../models/ActivityLog");
const { createNotification } = require("../utils/notifications");
const { requireAuth, requireRole } = require("../middleware/auth");
const { cacheWrap, cacheDel } = require("../lib/cache");

const router = express.Router();

// Helper function to generate the next AST- ID
async function getNextAssetId() {
  const sequence = await AssetSequence.findOneAndUpdate(
    {},
    { $inc: { sequence: 1 } },
    { new: true, upsert: true }
  );
  return `AST-${String(sequence.sequence).padStart(6, "0")}`;
}

async function syncAssetSequenceToCurrentMax() {
  const vMaxAgg = await Vehicle.aggregate([
    { $match: { frontendId: { $type: "string", $regex: /^AST-\d+$/ } } },
    {
      $project: {
        n: {
          $toInt: {
            $substrBytes: [
              "$frontendId",
              4,
              { $subtract: [{ $strLenBytes: "$frontendId" }, 4] },
            ],
          },
        },
      },
    },
    { $sort: { n: -1 } },
    { $limit: 1 },
  ]);

  const aMaxAgg = await Appliance.aggregate([
    { $match: { frontendId: { $type: "string", $regex: /^AST-\d+$/ } } },
    {
      $project: {
        n: {
          $toInt: {
            $substrBytes: [
              "$frontendId",
              4,
              { $subtract: [{ $strLenBytes: "$frontendId" }, 4] },
            ],
          },
        },
      },
    },
    { $sort: { n: -1 } },
    { $limit: 1 },
  ]);

  const vMax = Number(vMaxAgg?.[0]?.n) || 0;
  const aMax = Number(aMaxAgg?.[0]?.n) || 0;
  const max = Math.max(vMax, aMax);

  await AssetSequence.findOneAndUpdate({}, { $set: { sequence: max } }, { upsert: true, new: true });
  return max;
}

const uploadsDir = path.resolve(__dirname, "..", "..", "uploads", "appliances");
try {
  fs.mkdirSync(uploadsDir, { recursive: true });
} catch {
  
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const safeOriginal = String(file.originalname || "file").replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}_${safeOriginal}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
});

const createSchema = z.object({
  inventoryType: z.enum(["asset", "consumable", "sellable"]).optional().default("asset"),
  name: z.string().min(1),
  brand: z.string().optional().default(""),
  model: z.string().optional().default(""),
  location: z.string().optional().default(""),
  photoFileName: z.string().optional().default(""),
  photoDataUrl: z.string().optional().default(""),
  supplier: z.string().optional().default(""),
  status: z.string().optional().default("active"),

  // Asset fields
  serialNumber: z.string().optional().default(""),
  propertyType: z.enum(["commercial", "residential"]).optional().default("commercial"),
  purchaseDate: z.string().optional().default(""),
  warrantyUntil: z.string().optional().default(""),
  conditionStatus: z.enum(["excellent", "good", "fair", "damaged"]).optional().default("good"),
  assignedTo: z.string().optional().default(""),

  // Consumable fields
  quantity: z.coerce.number().optional().default(0),
  unitType: z.enum(["pieces", "boxes", "liters", "kg"]).optional().default("pieces"),
  reorderPoint: z.coerce.number().optional().default(0),
  dailyUsageRate: z.coerce.number().optional().default(0),

  // Sellable fields
  sku: z.string().optional().default(""),
  costPrice: z.coerce.number().optional().default(0),
  sellingPrice: z.coerce.number().optional().default(0),

  // Legacy compatibility
  category: z.string().optional().default("appliance"),
  warrantyExpiry: z.string().optional().default(""),
  lastMaintenance: z.string().optional().default(""),
  tagPhotoFileName: z.string().optional().default(""),
  tagPhotoDataUrl: z.string().optional().default(""),
});

const updateSchema = createSchema.partial();

// Helper to log activity
async function logActivity(req, action, resourceType, resourceId, resourceName, description) {
  try {
    await ActivityLog.create({
      actorUserId: String(req.user?.sub || req.user?.id || "unknown"),
      actorUsername: String(req.user?.username || req.user?.name || "unknown"),
      actorRole: String(req.user?.role || "unknown"),
      action,
      resourceType,
      resourceId: String(resourceId || ""),
      resourceName: String(resourceName || ""),
      description: String(description || ""),
      ipAddress: String(req.ip || req.headers["x-forwarded-for"] || ""),
      userAgent: String(req.headers["user-agent"] || ""),
      metadata: { body: req.body },
    });
  } catch (err) {
    console.error("Failed to log activity:", err);
  }
}

router.get("/", requireAuth, async (_req, res, next) => {
  try {
    const result = await cacheWrap("appliances:list", async () => {
      const items = await Appliance.find()
        .sort({ createdAt: -1 })
        .lean();
      return { items };
    }, 60);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Backfill missing frontendId (admin-only)
router.post("/backfill-frontend-ids", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const dryRun = String(req.query?.dryRun || "").toLowerCase() === "true";

    await syncAssetSequenceToCurrentMax();

    const missing = await Appliance.find({ $or: [{ frontendId: { $exists: false } }, { frontendId: "" }, { frontendId: null }] })
      .sort({ createdAt: 1, _id: 1 })
      .select({ _id: 1 })
      .lean();

    if (dryRun) {
      return res.json({ ok: true, dryRun: true, wouldUpdate: missing.length });
    }

    let updatedCount = 0;
    for (const doc of missing) {
      const newId = await getNextAssetId();
      const updated = await Appliance.updateOne(
        { _id: doc._id, $or: [{ frontendId: { $exists: false } }, { frontendId: "" }, { frontendId: null }] },
        { $set: { frontendId: newId } }
      );
      if (updated?.modifiedCount === 1) updatedCount += 1;
    }

    return res.json({ ok: true, updatedCount });
  } catch (err) {
    return next(err);
  }
});

router.post("/", requireAuth, async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { message: "Invalid payload" } });

    // Map warrantyUntil to warrantyExpiry for database compatibility
    const data = {
      ...parsed.data,
      warrantyExpiry: parsed.data.warrantyUntil || parsed.data.warrantyExpiry || "",
    };

    const created = await Appliance.create({
      frontendId: await getNextAssetId(),
      ...data,
    });
    
    // Log activity
    await logActivity(req, "APPLIANCE_CREATE", "appliance", created._id, created.name, `Created appliance: ${created.name}`);
    cacheDel("appliances:list");
    res.status(201).json({ item: created.toObject() });
  } catch (err) {
    next(err);
  }
});

router.put("/:id", requireAuth, async (req, res, next) => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { message: "Invalid payload" } });

    // Map warrantyUntil to warrantyExpiry for database compatibility
    const data = {
      ...parsed.data,
    };
    if (parsed.data.warrantyUntil !== undefined) {
      data.warrantyExpiry = parsed.data.warrantyUntil;
    }

    const updated = await Appliance.findByIdAndUpdate(req.params.id, data, { new: true }).lean();
    if (!updated) return res.status(404).json({ error: { message: "Appliance not found" } });

    // Log activity
    await logActivity(req, "APPLIANCE_UPDATE", "appliance", req.params.id, updated.name, `Updated appliance: ${updated.name}`);

    // Create notification
    await createNotification({
      actor: req.user?.username || req.user?.name || "Admin",
      actorRole: req.user?.role || "admin",
      action: "updated",
      resourceType: "appliance",
      resourceName: updated.name,
      details: data.status ? `Status: ${data.status}` : "",
      resourceId: String(req.params.id),
    });
    cacheDel("appliances:list");
    res.json({ item: updated });
  } catch (err) {
    next(err);
  }
});

router.post("/upload", requireAuth, upload.single("photoFile"), async (req, res, next) => {
  try {
    const body = req.body || {};
    const f = req.file;

    const photoAttachment = f
      ? {
          fileName: f.originalname,
          url: `/uploads/appliances/${f.filename}`,
          mimeType: f.mimetype,
          size: f.size,
        }
      : undefined;

    const created = await Appliance.create({
      frontendId: await getNextAssetId(),
      inventoryType: body.inventoryType || "asset",
      name: body.name,
      brand: body.brand || "",
      model: body.model || "",
      location: body.location || "",
      photoFileName: f?.originalname || body.photoFileName || "",
      photoDataUrl: body.photoDataUrl || "",
      photoAttachment,
      supplier: body.supplier || "",
      status: body.status || "active",
      serialNumber: body.serialNumber || "",
      propertyType: body.propertyType || "commercial",
      purchaseDate: body.purchaseDate || "",
      warrantyUntil: body.warrantyUntil || "",
      conditionStatus: body.conditionStatus || "good",
      assignedTo: body.assignedTo || "",
      quantity: Number(body.quantity || 0),
      unitType: body.unitType || "pieces",
      reorderPoint: Number(body.reorderPoint || 0),
      dailyUsageRate: Number(body.dailyUsageRate || 0),
      sku: body.sku || "",
      costPrice: Number(body.costPrice || 0),
      sellingPrice: Number(body.sellingPrice || 0),
      // Legacy
      category: body.category || "appliance",
      tagPhotoFileName: f?.originalname || body.tagPhotoFileName || "",
    });

    // Log activity
    await logActivity(req, "APPLIANCE_CREATE", "appliance", created._id, created.name, `Created ${created.inventoryType}: ${created.name}`);

    // Create notification
    await createNotification({
      actor: req.user?.username || req.user?.name || "Admin",
      actorRole: req.user?.role || "admin",
      action: "created",
      resourceType: "appliance",
      resourceName: created.name,
      details: `Type: ${created.inventoryType}`,
      resourceId: String(created._id),
    });
    cacheDel("appliances:list");
    return res.status(201).json({ item: created.toObject() });
  } catch (err) {
    return next(err);
  }
});

router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const deleted = await Appliance.findByIdAndDelete(req.params.id).lean();
    if (!deleted) return res.status(404).json({ error: { message: "Appliance not found" } });
    
    // Log activity
    await logActivity(req, "APPLIANCE_DELETE", "appliance", req.params.id, deleted.name, `Deleted appliance: ${deleted.name}`);

    // Create notification
    await createNotification({
      actor: req.user?.username || req.user?.name || "Admin",
      actorRole: req.user?.role || "admin",
      action: "deleted",
      resourceType: "appliance",
      resourceName: deleted.name,
      resourceId: String(req.params.id),
    });
    cacheDel("appliances:list");
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
