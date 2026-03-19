const express = require("express");
const { z } = require("zod");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const Vehicle = require("../models/Vehicle");
const { createNotification } = require("../utils/notifications");
const AssetSequence = require("../models/AssetSequence");
const Appliance = require("../models/Appliance");
const ActivityLog = require("../models/ActivityLog");
const { requireAuth, requireRole } = require("../middleware/auth");

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

function parseAstNumber(frontendId) {
  const v = String(frontendId || "").trim();
  const m = /^AST-(\d+)$/.exec(v);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
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

const uploadsDir = path.resolve(__dirname, "..", "..", "uploads", "vehicles");
try {
  fs.mkdirSync(uploadsDir, { recursive: true });
} catch {
  
}

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
});

const createSchema = z.object({
  name: z.string().min(1),
  type: z.string().optional().default(""),
  licensePlate: z.string().min(1),
  status: z.enum(["available", "in-use", "maintenance"]).optional(),
  assignedTo: z.string().nullable().optional(),
  fuelLevel: z.number().min(0).max(100).optional(),
  mileage: z.number().min(0).optional(),
  lastInspection: z.union([z.string(), z.date()]).optional(),
  nextInspection: z.union([z.string(), z.date()]).optional(),
  tagPhotoFileName: z.string().optional().default(""),
  tagPhotoDataUrl: z.string().optional().default(""),
});

const adminUiSchema = z.object({
  make: z.string().min(1),
  model: z.string().min(1),
  year: z.string().min(1),
  licensePlate: z.string().min(1),
  vin: z.string().optional().default(""),
  mileage: z.string().optional().default(""),
  status: z.enum(["active", "inactive", "maintenance"]).optional(),
  lastInspection: z.string().optional().default(""),
  nextInspection: z.string().optional().default(""),
  assignedTo: z.string().optional().default(""),
  tagPhotoFileName: z.string().optional().default(""),
  tagPhotoDataUrl: z.string().optional().default(""),
});

const adminUiUpdateSchema = z
  .object({
    make: z.string().optional(),
    model: z.string().optional(),
    year: z.string().optional(),
    licensePlate: z.string().optional(),
    vin: z.string().optional(),
    mileage: z.string().optional(),
    status: z.enum(["active", "inactive", "maintenance"]).optional(),
    lastInspection: z.string().optional(),
    nextInspection: z.string().optional(),
    assignedTo: z.string().optional(),
    tagPhotoFileName: z.string().optional(),
    tagPhotoDataUrl: z.string().optional(),
  })
  .partial();

const updateSchema = createSchema.partial();

function withId(doc) {
  if (!doc) return doc;
  return { ...doc, id: String(doc._id) };
}

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
    const items = await Vehicle.find().sort({ createdAt: -1 }).lean();
    res.json({ items: items.map(withId) });
  } catch (err) {
    next(err);
  }
});

// Backfill missing frontendId (admin-only)
router.post("/backfill-frontend-ids", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const dryRun = String(req.query?.dryRun || "").toLowerCase() === "true";

    await syncAssetSequenceToCurrentMax();

    const missing = await Vehicle.find({ $or: [{ frontendId: { $exists: false } }, { frontendId: "" }, { frontendId: null }] })
      .sort({ createdAt: 1, _id: 1 })
      .select({ _id: 1 })
      .lean();

    if (dryRun) {
      return res.json({ ok: true, dryRun: true, wouldUpdate: missing.length });
    }

    let updatedCount = 0;
    for (const doc of missing) {
      const newId = await getNextAssetId();
      const updated = await Vehicle.updateOne(
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
    // Debug logging
    console.log("[DEBUG] POST /vehicles req.body:", JSON.stringify(req.body, null, 2));
    console.log("[DEBUG] tagPhotoFileName:", req.body?.tagPhotoFileName);
    console.log("[DEBUG] tagPhotoDataUrl length:", req.body?.tagPhotoDataUrl?.length);
    
    const adminParsed = adminUiSchema.safeParse(req.body);
    if (adminParsed.success) {
      const name = `${adminParsed.data.year} ${adminParsed.data.make} ${adminParsed.data.model}`.trim();
      const mileageNumber = Number(String(adminParsed.data.mileage || "").replace(/[^0-9.]/g, "")) || 0;

      const created = await Vehicle.create({
        frontendId: await getNextAssetId(),
        name,
        make: adminParsed.data.make,
        model: adminParsed.data.model,
        year: adminParsed.data.year,
        type: adminParsed.data.model,
        licensePlate: adminParsed.data.licensePlate,
        vin: adminParsed.data.vin || "",
        status: adminParsed.data.status || "active",
        assignedTo: adminParsed.data.assignedTo || "-",
        mileage: mileageNumber,
        mileageText: adminParsed.data.mileage || "",
        lastInspection: adminParsed.data.lastInspection ? new Date(adminParsed.data.lastInspection) : undefined,
        nextInspection: adminParsed.data.nextInspection ? new Date(adminParsed.data.nextInspection) : undefined,
        tagPhotoFileName: adminParsed.data.tagPhotoFileName || "",
        tagPhotoDataUrl: adminParsed.data.tagPhotoDataUrl || "",
        fuelLevel: 100,
      });

      const obj = created.toObject();
      
      // Log activity
      await logActivity(req, "VEHICLE_CREATE", "vehicle", created._id, created.name, `Created vehicle: ${created.name}`);
      
      // Create notification
      await createNotification({
        actor: req.user?.username || req.user?.name || "Admin",
        actorRole: req.user?.role || "admin",
        action: "created",
        resourceType: "vehicle",
        resourceName: created.name,
        details: `License: ${created.licensePlate}`,
        resourceId: String(created._id),
      });
      
      return res.status(201).json({ item: withId(obj) });
    }

    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload" } });
    }

    const created = await Vehicle.create({
      frontendId: await getNextAssetId(),
      ...parsed.data,
      tagPhotoFileName: parsed.data.tagPhotoFileName || "",
      tagPhotoDataUrl: parsed.data.tagPhotoDataUrl || "",
      lastInspection: parsed.data.lastInspection ? new Date(parsed.data.lastInspection) : undefined,
      nextInspection: parsed.data.nextInspection ? new Date(parsed.data.nextInspection) : undefined,
    });

    const obj = created.toObject();
    return res.status(201).json({ item: withId(obj) });
  } catch (err) {
    return next(err);
  }
});

router.post("/upload", requireAuth, upload.fields([{ name: "registrationFile", maxCount: 1 }, { name: "insuranceFile", maxCount: 1 }]), async (req, res, next) => {
  try {
    const body = req.body || {};
    const name = `${body.year} ${body.make} ${body.model}`.trim();
    const mileageNumber = Number(String(body.mileage || "").replace(/[^0-9.]/g, "")) || 0;

    const files = req.files || {};
    const regFile = Array.isArray(files.registrationFile) ? files.registrationFile[0] : undefined;
    const insFile = Array.isArray(files.insuranceFile) ? files.insuranceFile[0] : undefined;

    // For Vercel serverless, store file metadata without saving to disk
    const registrationAttachment = regFile
      ? {
          fileName: regFile.originalname,
          url: "", // Not persisted on serverless
          mimeType: regFile.mimetype,
          size: regFile.size,
        }
      : undefined;

    const insuranceAttachment = insFile
      ? {
          fileName: insFile.originalname,
          url: "", // Not persisted on serverless
          mimeType: insFile.mimetype,
          size: insFile.size,
        }
      : undefined;

    const created = await Vehicle.create({
      frontendId: await getNextAssetId(),
      name,
      make: body.make,
      model: body.model,
      year: body.year,
      type: body.model,
      licensePlate: body.licensePlate,
      vin: body.vin || "",
      status: body.status || "active",
      assignedTo: body.assignedTo || "-",
      mileage: mileageNumber,
      mileageText: body.mileage || "",
      lastInspection: body.lastInspection ? new Date(body.lastInspection) : undefined,
      nextInspection: body.nextInspection ? new Date(body.nextInspection) : undefined,
      registrationFileName: regFile?.originalname || body.registrationFileName || "",
      insuranceFileName: insFile?.originalname || body.insuranceFileName || "",
      registrationAttachment,
      insuranceAttachment,
      fuelLevel: 100,
    });

    const obj = created.toObject();
    return res.status(201).json({ item: withId(obj) });
  } catch (err) {
    return next(err);
  }
});

router.put("/:id", requireAuth, async (req, res, next) => {
  try {
    const adminParsed = adminUiUpdateSchema.safeParse(req.body);
    if (adminParsed.success) {
      const patch = {};
      if (typeof adminParsed.data.make === "string" && adminParsed.data.make.trim()) patch.make = adminParsed.data.make;
      if (typeof adminParsed.data.model === "string" && adminParsed.data.model.trim()) patch.model = adminParsed.data.model;
      if (typeof adminParsed.data.year === "string" && adminParsed.data.year.trim()) patch.year = adminParsed.data.year;
      if (typeof adminParsed.data.licensePlate === "string" && adminParsed.data.licensePlate.trim()) {
        patch.licensePlate = adminParsed.data.licensePlate;
      }
      if (typeof adminParsed.data.vin === "string") patch.vin = adminParsed.data.vin;
      if (typeof adminParsed.data.status === "string") patch.status = adminParsed.data.status;
      if (typeof adminParsed.data.assignedTo === "string") patch.assignedTo = adminParsed.data.assignedTo || "-";
      if (typeof adminParsed.data.mileage === "string") {
        patch.mileageText = adminParsed.data.mileage;
        patch.mileage = Number(String(adminParsed.data.mileage || "").replace(/[^0-9.]/g, "")) || 0;
      }
      if (typeof adminParsed.data.lastInspection === "string") {
        patch.lastInspection = adminParsed.data.lastInspection ? new Date(adminParsed.data.lastInspection) : undefined;
      }
      if (typeof adminParsed.data.nextInspection === "string") {
        patch.nextInspection = adminParsed.data.nextInspection ? new Date(adminParsed.data.nextInspection) : undefined;
      }
      if (typeof adminParsed.data.tagPhotoFileName === "string") patch.tagPhotoFileName = adminParsed.data.tagPhotoFileName;
      if (typeof adminParsed.data.tagPhotoDataUrl === "string") patch.tagPhotoDataUrl = adminParsed.data.tagPhotoDataUrl;

      if (typeof patch.year === "string" || typeof patch.make === "string" || typeof patch.model === "string") {
        const existing = await Vehicle.findById(req.params.id).lean();
        const y = typeof patch.year === "string" ? patch.year : existing?.year || "";
        const mk = typeof patch.make === "string" ? patch.make : existing?.make || "";
        const md = typeof patch.model === "string" ? patch.model : existing?.model || "";
        patch.name = `${y} ${mk} ${md}`.trim();
      }

      const updated = await Vehicle.findByIdAndUpdate(req.params.id, patch, { new: true }).lean();
      if (!updated) return res.status(404).json({ error: { message: "Vehicle not found" } });
      
      // Log activity
      await logActivity(req, "VEHICLE_UPDATE", "vehicle", req.params.id, updated.name, `Updated vehicle: ${updated.name}`);
      
      // Create notification
      await createNotification({
        actor: req.user?.username || req.user?.name || "Admin",
        actorRole: req.user?.role || "admin",
        action: "updated",
        resourceType: "vehicle",
        resourceName: updated.name,
        details: patch.status ? `Status: ${patch.status}` : "",
        resourceId: String(req.params.id),
      });
      
      return res.json({ item: withId(updated) });
    }

    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload" } });
    }

    const patch = { ...parsed.data };
    if (patch.lastInspection) patch.lastInspection = new Date(patch.lastInspection);
    if (patch.nextInspection) patch.nextInspection = new Date(patch.nextInspection);
    // Ensure photo fields are included in the update
    if (typeof parsed.data.tagPhotoFileName === "string") patch.tagPhotoFileName = parsed.data.tagPhotoFileName;
    if (typeof parsed.data.tagPhotoDataUrl === "string") patch.tagPhotoDataUrl = parsed.data.tagPhotoDataUrl;

    const updated = await Vehicle.findByIdAndUpdate(req.params.id, patch, {
      new: true,
    }).lean();

    if (!updated) {
      return res.status(404).json({ error: { message: "Vehicle not found" } });
    }

    // Log activity
    await logActivity(req, "VEHICLE_UPDATE", "vehicle", req.params.id, updated.name, `Updated vehicle: ${updated.name}`);

    // Create notification
    await createNotification({
      actor: req.user?.username || req.user?.name || "Admin",
      actorRole: req.user?.role || "admin",
      action: "updated",
      resourceType: "vehicle",
      resourceName: updated.name,
      resourceId: String(req.params.id),
    });

    return res.json({ item: withId(updated) });
  } catch (err) {
    return next(err);
  }
});

router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const deleted = await Vehicle.findByIdAndDelete(req.params.id).lean();
    if (!deleted) {
      return res.status(404).json({ error: { message: "Vehicle not found" } });
    }
    
    // Log activity
    await logActivity(req, "VEHICLE_DELETE", "vehicle", req.params.id, deleted.name, `Deleted vehicle: ${deleted.name}`);
    
    // Create notification
    await createNotification({
      actor: req.user?.username || req.user?.name || "Admin",
      actorRole: req.user?.role || "admin",
      action: "deleted",
      resourceType: "vehicle",
      resourceName: deleted.name,
      resourceId: String(req.params.id),
    });
    
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
