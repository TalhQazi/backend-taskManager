const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { z } = require("zod");

const FinishRecord = require("../models/FinishRecord");
const FinishRecordPhoto = require("../models/FinishRecordPhoto");
const FinishAssignment = require("../models/FinishAssignment");
const FinishRecordAudit = require("../models/FinishRecordAudit");
const FinishTaxonomy = require("../models/FinishTaxonomy");
const Location = require("../models/Location");
const ActivityLog = require("../models/ActivityLog");
const { requireAuth, requireClearHire } = require("../middleware/auth");
const { uploadToS3 } = require("../lib/s3");

const router = express.Router();

// ---------------------------------------------------------------------------
// File Upload Setup
// ---------------------------------------------------------------------------
const uploadsDir = path.resolve(__dirname, "..", "..", "uploads", "finishes");
try {
  fs.mkdirSync(uploadsDir, { recursive: true });
} catch {
  // Directory exists
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const safeOriginal = String(file.originalname || "finish_photo").replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}_${safeOriginal}`);
  },
});

const fileFilter = (_req, file, cb) => {
  const allowedMimes = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/heic",
    "image/heif",
    "application/pdf",
  ];
  if (allowedMimes.includes(file.mimetype) || file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(new Error("Unsupported file type. Only JPEG, PNG, WEBP, HEIC, and PDF are allowed."));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB limit
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getActorInfo(req) {
  const userId = String(req.user?.sub || req.user?.id || req.user?._id || "system");
  const username = String(req.user?.name || req.user?.username || req.user?.email || "Unknown User");
  const role = String(req.user?.role || "user").toLowerCase();
  const organizationId = String(req.user?.organizationId || req.user?.company || "");
  return { userId, username, role, organizationId };
}

function canEditFinishes(role) {
  const r = String(role || "").toLowerCase();
  return ["super-admin", "admin", "manager", "team-lead", "coder", "employee"].includes(r);
}

function canManageTaxonomies(role) {
  const r = String(role || "").toLowerCase();
  return ["super-admin", "admin"].includes(r);
}

async function recordAudit({ finishRecordId, actorUserId, actorUsername, action, beforeJson, afterJson, source }) {
  try {
    await FinishRecordAudit.create({
      finishRecordId,
      actorUserId,
      actorUsername,
      action,
      beforeJson: beforeJson || null,
      afterJson: afterJson || null,
      source: source || "web",
      createdAt: new Date(),
    });
  } catch (err) {
    console.error("[FinishRecordAudit] Failed to log audit event:", err.message);
  }
}

// ---------------------------------------------------------------------------
// TAXONOMIES: List & Seed
// ---------------------------------------------------------------------------
router.get("/taxonomies", requireAuth, async (req, res, next) => {
  try {
    const { organizationId } = getActorInfo(req);
    const orgScope = organizationId ? [organizationId, "global"] : ["global"];

    const customTaxonomies = await FinishTaxonomy.find({
      organizationId: { $in: orgScope },
      isActive: true,
    })
      .sort({ sortOrder: 1, name: 1 })
      .lean();

    const defaultSurfaces = FinishTaxonomy.getDefaultSurfaces();
    const defaultSheens = FinishTaxonomy.getDefaultSheens();
    const defaultMaterials = FinishTaxonomy.getDefaultMaterials();

    // Merge default and custom
    const customSurfaces = customTaxonomies
      .filter((t) => t.category === "surface")
      .map((t) => t.name);
    const allSurfaces = Array.from(new Set([...defaultSurfaces, ...customSurfaces]));

    const customSheens = customTaxonomies
      .filter((t) => t.category === "sheen")
      .map((t) => t.name);
    const allSheens = Array.from(new Set([...defaultSheens, ...customSheens]));

    const customMaterials = customTaxonomies
      .filter((t) => t.category === "material")
      .map((t) => t.name);
    const allMaterials = Array.from(new Set([...defaultMaterials, ...customMaterials]));

    res.json({
      success: true,
      surfaces: allSurfaces,
      sheens: allSheens,
      materials: allMaterials,
      customList: customTaxonomies,
    });
  } catch (err) {
    next(err);
  }
});

// TAXONOMIES: Add custom surface/sheen (Admins only)
router.post("/taxonomies", requireAuth, async (req, res, next) => {
  try {
    const { role, organizationId } = getActorInfo(req);
    if (!canManageTaxonomies(role)) {
      return res.status(403).json({ error: { message: "Only administrators can manage taxonomies." } });
    }

    const { category, name, description } = req.body;
    if (!category || !name) {
      return res.status(400).json({ error: { message: "Category and name are required." } });
    }

    const code = String(name).toLowerCase().replace(/[^a-z0-9]/g, "_");
    const item = await FinishTaxonomy.findOneAndUpdate(
      { organizationId: organizationId || "global", category, code },
      {
        organizationId: organizationId || "global",
        category,
        name: String(name).trim(),
        code,
        description: description || "",
        isCustom: true,
        isActive: true,
      },
      { upsert: true, new: true }
    );

    res.status(201).json({ success: true, item });
  } catch (err) {
    next(err);
  }
});

// TAXONOMIES: Deactivate / Delete custom item
router.delete("/taxonomies/:id", requireAuth, async (req, res, next) => {
  try {
    const { role } = getActorInfo(req);
    if (!canManageTaxonomies(role)) {
      return res.status(403).json({ error: { message: "Only administrators can remove taxonomies." } });
    }

    await FinishTaxonomy.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ success: true, message: "Taxonomy deactivated." });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// WHAT PAINT DO I NEED? QUICK LOOKUP
// ---------------------------------------------------------------------------
router.get("/lookup", requireAuth, async (req, res, next) => {
  try {
    const { propertyId, unitAreaName, roomZoneName, surfaceTypeName } = req.query;

    if (!propertyId || !surfaceTypeName) {
      return res.status(400).json({
        error: { message: "propertyId and surfaceTypeName are required for paint lookup." },
      });
    }

    const cleanPropId = String(propertyId).trim();
    const cleanSurface = String(surfaceTypeName).trim();
    const cleanUnit = String(unitAreaName || "").trim();
    const cleanRoom = String(roomZoneName || "").trim();

    // Step 1: Check for exact match: Property + Unit + Room + Surface
    let candidate = null;
    if (cleanUnit && cleanRoom) {
      candidate = await FinishRecord.findOne({
        propertyId: cleanPropId,
        unitAreaName: new RegExp(`^${cleanUnit}$`, "i"),
        roomZoneName: new RegExp(`^${cleanRoom}$`, "i"),
        surfaceTypeName: new RegExp(`^${cleanSurface}$`, "i"),
        recordStatus: "CURRENT",
      }).lean();
    }

    // Step 2: Fallback to Property + Unit + Surface
    if (!candidate && cleanUnit) {
      candidate = await FinishRecord.findOne({
        propertyId: cleanPropId,
        unitAreaName: new RegExp(`^${cleanUnit}$`, "i"),
        surfaceTypeName: new RegExp(`^${cleanSurface}$`, "i"),
        recordStatus: "CURRENT",
      }).lean();
    }

    // Step 3: Fallback to Property-level Surface (exterior siding, common areas, etc.)
    if (!candidate) {
      candidate = await FinishRecord.findOne({
        propertyId: cleanPropId,
        surfaceTypeName: new RegExp(`^${cleanSurface}$`, "i"),
        recordStatus: "CURRENT",
      }).lean();
    }

    // Also check FinishAssignment if not found directly
    if (!candidate) {
      const assignmentQuery = {
        propertyId: cleanPropId,
        surfaceTypeName: new RegExp(`^${cleanSurface}$`, "i"),
        isCurrent: true,
      };
      if (cleanUnit) {
        assignmentQuery.unitAreaName = new RegExp(`^${cleanUnit}$`, "i");
      }
      const assignment = await FinishAssignment.findOne(assignmentQuery).lean();
      if (assignment) {
        candidate = await FinishRecord.findById(assignment.finishRecordId).lean();
      }
    }

    if (!candidate) {
      return res.json({
        success: true,
        found: false,
        message: `No active Current finish record found for ${cleanSurface} at this location.`,
      });
    }

    // Attach photos and historical records
    const photos = await FinishRecordPhoto.find({ finishRecordId: candidate._id })
      .sort({ sortOrder: 1, createdAt: 1 })
      .lean();

    const previousRecords = await FinishRecord.find({
      propertyId: cleanPropId,
      surfaceTypeName: candidate.surfaceTypeName,
      recordStatus: "PREVIOUS",
    })
      .sort({ effectiveTo: -1 })
      .limit(3)
      .lean();

    res.json({
      success: true,
      found: true,
      finish: {
        ...candidate,
        id: String(candidate._id),
        photos,
        previousRecords,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// FINISH RECORDS: List & Filter
// ---------------------------------------------------------------------------
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const {
      propertyId,
      unitAreaName,
      surfaceTypeName,
      status,
      useType,
      manufacturer,
      colorCode,
      search,
      page = 1,
      limit = 50,
    } = req.query;

    const query = {};

    if (propertyId) {
      query.propertyId = String(propertyId).trim();
    }

    if (status && status !== "ALL") {
      query.recordStatus = String(status).toUpperCase();
    } else if (!status) {
      // By default, prioritize CURRENT and PREVIOUS, exclude ARCHIVED unless requested
      query.recordStatus = { $in: ["CURRENT", "PREVIOUS", "DRAFT"] };
    }

    if (unitAreaName) {
      query.unitAreaName = new RegExp(String(unitAreaName).trim(), "i");
    }

    if (surfaceTypeName) {
      query.surfaceTypeName = new RegExp(String(surfaceTypeName).trim(), "i");
    }

    if (useType && useType !== "ALL") {
      query.useType = String(useType);
    }

    if (manufacturer) {
      query.manufacturer = new RegExp(String(manufacturer).trim(), "i");
    }

    if (colorCode) {
      // Support exact and partial matching without converting to number
      query.colorCode = new RegExp(String(colorCode).trim(), "i");
    }

    if (search) {
      const s = String(search).trim();
      query.$or = [
        { colorName: new RegExp(s, "i") },
        { colorCode: new RegExp(s, "i") },
        { manufacturer: new RegExp(s, "i") },
        { productLine: new RegExp(s, "i") },
        { surfaceTypeName: new RegExp(s, "i") },
        { unitAreaName: new RegExp(s, "i") },
        { roomZoneName: new RegExp(s, "i") },
        { notes: new RegExp(s, "i") },
        { purchasedFrom: new RegExp(s, "i") },
        { storeLocation: new RegExp(s, "i") },
      ];
    }

    const p = Math.max(1, parseInt(page, 10) || 1);
    const lim = Math.max(1, Math.min(100, parseInt(limit, 10) || 50));
    const skip = (p - 1) * lim;

    // Prioritize CURRENT records first, then by updated date
    const sort = {
      recordStatus: 1, // 'ARCHIVED', 'CURRENT', 'DRAFT', 'PREVIOUS'
      updatedAt: -1,
    };

    const [items, total] = await Promise.all([
      FinishRecord.find(query)
        .sort(sort)
        .skip(skip)
        .limit(lim)
        .lean(),
      FinishRecord.countDocuments(query),
    ]);

    // Attach primary photo or thumbnail for each record
    const recordIds = items.map((i) => i._id);
    const photos = await FinishRecordPhoto.find({ finishRecordId: { $in: recordIds } })
      .sort({ sortOrder: 1, createdAt: 1 })
      .lean();

    const photosByRecord = {};
    for (const ph of photos) {
      const rid = String(ph.finishRecordId);
      if (!photosByRecord[rid]) photosByRecord[rid] = [];
      photosByRecord[rid].push(ph);
    }

    const formatted = items.map((item) => {
      const itemPhotos = photosByRecord[String(item._id)] || [];
      return {
        ...item,
        id: String(item._id),
        photosCount: itemPhotos.length,
        primaryPhoto: itemPhotos[0] || null,
        photos: itemPhotos,
      };
    });

    res.json({
      success: true,
      items: formatted,
      total,
      page: p,
      limit: lim,
      totalPages: Math.ceil(total / lim),
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET FINISH RECORD DETAILS
// ---------------------------------------------------------------------------
router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const record = await FinishRecord.findById(req.params.id).lean();
    if (!record) {
      return res.status(404).json({ error: { message: "Finish record not found." } });
    }

    const [photos, assignments, audits, previousRecords] = await Promise.all([
      FinishRecordPhoto.find({ finishRecordId: record._id }).sort({ sortOrder: 1, createdAt: 1 }).lean(),
      FinishAssignment.find({ finishRecordId: record._id }).sort({ createdAt: -1 }).lean(),
      FinishRecordAudit.find({ finishRecordId: record._id }).sort({ createdAt: -1 }).limit(30).lean(),
      FinishRecord.find({
        propertyId: record.propertyId,
        surfaceTypeName: record.surfaceTypeName,
        unitAreaName: record.unitAreaName,
        _id: { $ne: record._id },
      })
        .sort({ effectiveTo: -1, createdAt: -1 })
        .limit(5)
        .lean(),
    ]);

    res.json({
      success: true,
      finish: {
        ...record,
        id: String(record._id),
        photos,
        assignments,
        audits,
        previousRecords: previousRecords.map((r) => ({ ...r, id: String(r._id) })),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// CREATE FINISH RECORD
// ---------------------------------------------------------------------------
const finishPayloadSchema = z.object({
  propertyId: z.string().min(1, "Property ID is required"),
  propertyName: z.string().optional().default(""),
  buildingId: z.string().optional().default(""),
  buildingName: z.string().optional().default(""),
  unitAreaId: z.string().optional().default(""),
  unitAreaName: z.string().optional().default(""),
  roomZoneId: z.string().optional().default(""),
  roomZoneName: z.string().optional().default(""),
  surfaceTypeId: z.string().min(1, "Surface is required"),
  surfaceTypeName: z.string().min(1, "Surface Name is required"),
  materialCategory: z.string().optional().default("paint"),
  recordStatus: z.enum(["CURRENT", "PREVIOUS", "DRAFT", "ARCHIVED"]).optional().default("CURRENT"),
  manufacturer: z.string().optional().default(""),
  productLine: z.string().optional().default(""),
  colorName: z.string().optional().default(""),
  colorCode: z.string().optional().default(""),
  customMixFormula: z.string().optional().default(""),
  sheenFinish: z.string().optional().default(""),
  useType: z.enum(["Interior", "Exterior", "Both", "N/A"]).optional().default("Interior"),
  primerUsed: z.string().optional().default(""),
  coats: z.number().optional().default(2),
  quantityUsed: z.number().optional().default(0),
  quantityUnit: z.string().optional().default("Gallons"),
  coverageNotes: z.string().optional().default(""),
  purchasedFrom: z.string().optional().default(""),
  storeLocation: z.string().optional().default(""),
  unitCost: z.number().optional().default(0),
  currency: z.string().optional().default("USD"),
  dateApplied: z.string().optional().nullable(),
  appliedBy: z.string().optional().default(""),
  notes: z.string().optional().default(""),
  hexColor: z.string().optional().default(""),
  isSharedTemplate: z.boolean().optional().default(false),
  photos: z
    .array(
      z.object({
        photoType: z.string().optional(),
        fileUrl: z.string(),
        caption: z.string().optional(),
        thumbnailUrl: z.string().optional(),
      })
    )
    .optional(),
});

router.post("/", requireAuth, async (req, res, next) => {
  try {
    const actor = getActorInfo(req);
    if (!canEditFinishes(actor.role)) {
      return res.status(403).json({ error: { message: "You are not authorized to create finish records." } });
    }

    const parseResult = finishPayloadSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: {
          message: "Validation failed: " + parseResult.error.errors.map((e) => e.message).join(", "),
        },
      });
    }

    const data = parseResult.data;

    // Auto-fetch property name if not passed
    let propertyName = data.propertyName;
    if (!propertyName && data.propertyId) {
      const loc = await Location.findById(data.propertyId).select("name").lean();
      if (loc) propertyName = loc.name;
    }

    const now = new Date();

    // Transactional supersede: If saving as CURRENT, check for existing CURRENT record
    let supersededRecord = null;
    if (data.recordStatus === "CURRENT") {
      const matchCriteria = {
        propertyId: data.propertyId,
        surfaceTypeName: data.surfaceTypeName,
        recordStatus: "CURRENT",
      };
      if (data.unitAreaName) {
        matchCriteria.unitAreaName = data.unitAreaName;
      }
      if (data.roomZoneName) {
        matchCriteria.roomZoneName = data.roomZoneName;
      }

      supersededRecord = await FinishRecord.findOne(matchCriteria);

      if (supersededRecord) {
        const beforeJson = supersededRecord.toObject();
        supersededRecord.recordStatus = "PREVIOUS";
        supersededRecord.effectiveTo = now;
        supersededRecord.updatedBy = actor.userId;
        supersededRecord.updatedByName = actor.username;
        supersededRecord.version = (supersededRecord.version || 1) + 1;
        await supersededRecord.save();

        await recordAudit({
          finishRecordId: supersededRecord._id,
          actorUserId: actor.userId,
          actorUsername: actor.username,
          action: "SUPERSEDE",
          beforeJson,
          afterJson: supersededRecord.toObject(),
          source: req.headers["x-client-source"] || "web",
        });
      }
    }

    const newRecord = await FinishRecord.create({
      ...data,
      propertyName,
      organizationId: actor.organizationId,
      effectiveFrom: data.recordStatus === "CURRENT" ? now : null,
      effectiveTo: null,
      dateApplied: data.dateApplied ? new Date(data.dateApplied) : null,
      createdBy: actor.userId,
      createdByName: actor.username,
      updatedBy: actor.userId,
      updatedByName: actor.username,
      version: 1,
    });

    // Handle embedded photos if supplied
    if (Array.isArray(data.photos) && data.photos.length > 0) {
      const photoDocs = data.photos.map((p, idx) => ({
        finishRecordId: newRecord._id,
        photoType: p.photoType || "paint_can",
        fileUrl: p.fileUrl,
        thumbnailUrl: p.thumbnailUrl || p.fileUrl,
        caption: p.caption || "",
        sortOrder: idx,
        uploadedBy: actor.userId,
        uploadedByName: actor.username,
      }));
      await FinishRecordPhoto.insertMany(photoDocs);
    }

    // Also register primary FinishAssignment
    await FinishAssignment.create({
      finishRecordId: newRecord._id,
      propertyId: newRecord.propertyId,
      propertyName: newRecord.propertyName,
      buildingId: newRecord.buildingId,
      buildingName: newRecord.buildingName,
      unitAreaId: newRecord.unitAreaId,
      unitAreaName: newRecord.unitAreaName,
      roomZoneId: newRecord.roomZoneId,
      roomZoneName: newRecord.roomZoneName,
      surfaceTypeId: newRecord.surfaceTypeId,
      surfaceTypeName: newRecord.surfaceTypeName,
      isCurrent: newRecord.recordStatus === "CURRENT",
      effectiveFrom: newRecord.effectiveFrom || now,
      effectiveTo: null,
      createdBy: actor.userId,
      createdByName: actor.username,
    });

    // Record CREATE audit
    await recordAudit({
      finishRecordId: newRecord._id,
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: "CREATE",
      beforeJson: null,
      afterJson: newRecord.toObject(),
      source: req.headers["x-client-source"] || "web",
    });

    const responseRecord = await FinishRecord.findById(newRecord._id).lean();
    const photos = await FinishRecordPhoto.find({ finishRecordId: newRecord._id }).lean();

    res.status(201).json({
      success: true,
      finish: {
        ...responseRecord,
        id: String(responseRecord._id),
        photos,
        supersededRecordId: supersededRecord ? String(supersededRecord._id) : null,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Also support POST /api/properties/:propertyId/finishes for direct property nesting
router.post("/property/:propertyId", requireAuth, async (req, res, next) => {
  req.body.propertyId = req.params.propertyId;
  return router.handle(req, res, next);
});

// ---------------------------------------------------------------------------
// UPDATE FINISH RECORD (with Optimistic Concurrency Protection)
// ---------------------------------------------------------------------------
router.patch("/:id", requireAuth, async (req, res, next) => {
  try {
    const actor = getActorInfo(req);
    if (!canEditFinishes(actor.role)) {
      return res.status(403).json({ error: { message: "You are not authorized to edit finish records." } });
    }

    const existing = await FinishRecord.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: { message: "Finish record not found." } });
    }

    // Optimistic Concurrency check
    if (req.body.version !== undefined && Number(req.body.version) !== existing.version) {
      return res.status(409).json({
        error: {
          message:
            "Concurrent modification conflict: this record has been modified by another user. Please reload and review the latest changes.",
          currentVersion: existing.version,
        },
      });
    }

    const beforeJson = existing.toObject();

    // Update allowable fields
    const fields = [
      "propertyName",
      "buildingId",
      "buildingName",
      "unitAreaId",
      "unitAreaName",
      "roomZoneId",
      "roomZoneName",
      "surfaceTypeId",
      "surfaceTypeName",
      "materialCategory",
      "manufacturer",
      "productLine",
      "colorName",
      "colorCode",
      "customMixFormula",
      "sheenFinish",
      "useType",
      "primerUsed",
      "coats",
      "quantityUsed",
      "quantityUnit",
      "coverageNotes",
      "purchasedFrom",
      "storeLocation",
      "unitCost",
      "currency",
      "appliedBy",
      "notes",
      "hexColor",
      "isSharedTemplate",
    ];

    for (const f of fields) {
      if (req.body[f] !== undefined) {
        existing[f] = req.body[f];
      }
    }

    if (req.body.dateApplied !== undefined) {
      existing.dateApplied = req.body.dateApplied ? new Date(req.body.dateApplied) : null;
    }

    existing.version = (existing.version || 1) + 1;
    existing.updatedBy = actor.userId;
    existing.updatedByName = actor.username;
    await existing.save();

    await recordAudit({
      finishRecordId: existing._id,
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: "UPDATE",
      beforeJson,
      afterJson: existing.toObject(),
      source: req.headers["x-client-source"] || "web",
    });

    res.json({
      success: true,
      finish: {
        ...existing.toObject(),
        id: String(existing._id),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// SET CURRENT (Promote / Supersede)
// ---------------------------------------------------------------------------
router.post("/:id/set-current", requireAuth, async (req, res, next) => {
  try {
    const actor = getActorInfo(req);
    if (!canEditFinishes(actor.role)) {
      return res.status(403).json({ error: { message: "You are not authorized to change record status." } });
    }

    const target = await FinishRecord.findById(req.params.id);
    if (!target) {
      return res.status(404).json({ error: { message: "Finish record not found." } });
    }

    const now = new Date();

    // 1. Find existing CURRENT for same target
    const existingCurrent = await FinishRecord.findOne({
      propertyId: target.propertyId,
      surfaceTypeName: target.surfaceTypeName,
      unitAreaName: target.unitAreaName,
      roomZoneName: target.roomZoneName,
      recordStatus: "CURRENT",
      _id: { $ne: target._id },
    });

    if (existingCurrent) {
      const beforeJson = existingCurrent.toObject();
      existingCurrent.recordStatus = "PREVIOUS";
      existingCurrent.effectiveTo = now;
      existingCurrent.updatedBy = actor.userId;
      existingCurrent.updatedByName = actor.username;
      existingCurrent.version = (existingCurrent.version || 1) + 1;
      await existingCurrent.save();

      await recordAudit({
        finishRecordId: existingCurrent._id,
        actorUserId: actor.userId,
        actorUsername: actor.username,
        action: "SUPERSEDE",
        beforeJson,
        afterJson: existingCurrent.toObject(),
        source: req.headers["x-client-source"] || "web",
      });

      // Update assignment
      await FinishAssignment.updateMany(
        { finishRecordId: existingCurrent._id, isCurrent: true },
        { isCurrent: false, effectiveTo: now }
      );
    }

    // 2. Set this record as CURRENT
    const targetBefore = target.toObject();
    target.recordStatus = "CURRENT";
    target.effectiveFrom = now;
    target.effectiveTo = null;
    target.updatedBy = actor.userId;
    target.updatedByName = actor.username;
    target.version = (target.version || 1) + 1;
    await target.save();

    await recordAudit({
      finishRecordId: target._id,
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: "SET_CURRENT",
      beforeJson: targetBefore,
      afterJson: target.toObject(),
      source: req.headers["x-client-source"] || "web",
    });

    await FinishAssignment.updateMany(
      { finishRecordId: target._id },
      { isCurrent: true, effectiveFrom: now, effectiveTo: null }
    );

    res.json({
      success: true,
      finish: { ...target.toObject(), id: String(target._id) },
      supersededId: existingCurrent ? String(existingCurrent._id) : null,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// ARCHIVE RECORD
// ---------------------------------------------------------------------------
router.post("/:id/archive", requireAuth, async (req, res, next) => {
  try {
    const actor = getActorInfo(req);
    if (!canEditFinishes(actor.role)) {
      return res.status(403).json({ error: { message: "You are not authorized to archive records." } });
    }

    const record = await FinishRecord.findById(req.params.id);
    if (!record) {
      return res.status(404).json({ error: { message: "Finish record not found." } });
    }

    const beforeJson = record.toObject();
    record.recordStatus = "ARCHIVED";
    record.effectiveTo = new Date();
    record.updatedBy = actor.userId;
    record.updatedByName = actor.username;
    record.version = (record.version || 1) + 1;
    await record.save();

    await FinishAssignment.updateMany(
      { finishRecordId: record._id },
      { isCurrent: false, effectiveTo: new Date() }
    );

    await recordAudit({
      finishRecordId: record._id,
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: "ARCHIVE",
      beforeJson,
      afterJson: record.toObject(),
      source: req.headers["x-client-source"] || "web",
    });

    res.json({ success: true, message: "Record archived successfully." });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// RESTORE RECORD
// ---------------------------------------------------------------------------
router.post("/:id/restore", requireAuth, async (req, res, next) => {
  try {
    const actor = getActorInfo(req);
    if (!canEditFinishes(actor.role)) {
      return res.status(403).json({ error: { message: "You are not authorized to restore records." } });
    }

    const record = await FinishRecord.findById(req.params.id);
    if (!record) {
      return res.status(404).json({ error: { message: "Finish record not found." } });
    }

    const beforeJson = record.toObject();
    // Restore as PREVIOUS to avoid accidental CURRENT collisions unless explicitly set
    record.recordStatus = "PREVIOUS";
    record.updatedBy = actor.userId;
    record.updatedByName = actor.username;
    record.version = (record.version || 1) + 1;
    await record.save();

    await recordAudit({
      finishRecordId: record._id,
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: "RESTORE",
      beforeJson,
      afterJson: record.toObject(),
      source: req.headers["x-client-source"] || "web",
    });

    res.json({ success: true, message: "Record restored as previous version." });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// APPLY TO OTHER AREAS (Multi-Destination Assignment & Overrides)
// ---------------------------------------------------------------------------
router.post("/:id/assignments", requireAuth, async (req, res, next) => {
  try {
    const actor = getActorInfo(req);
    if (!canEditFinishes(actor.role)) {
      return res.status(403).json({ error: { message: "You are not authorized to apply finish records." } });
    }

    const finishRecord = await FinishRecord.findById(req.params.id);
    if (!finishRecord) {
      return res.status(404).json({ error: { message: "Finish record not found." } });
    }

    const { destinations, setCurrent = true, makeIndependentCopies = false } = req.body;

    if (!Array.isArray(destinations) || destinations.length === 0) {
      return res.status(400).json({ error: { message: "At least one destination is required." } });
    }

    const now = new Date();
    const createdAssignments = [];
    const createdCopies = [];

    for (const dest of destinations) {
      const destPropId = dest.propertyId || finishRecord.propertyId;
      const destPropName = dest.propertyName || finishRecord.propertyName;
      const destUnitName = dest.unitAreaName || "";
      const destRoomName = dest.roomZoneName || "";
      const destSurfaceName = dest.surfaceTypeName || finishRecord.surfaceTypeName;
      const destSurfaceId = dest.surfaceTypeId || finishRecord.surfaceTypeId;

      if (makeIndependentCopies) {
        // Create an independent copy for this location
        const copyDoc = new FinishRecord({
          ...finishRecord.toObject(),
          _id: undefined,
          propertyId: destPropId,
          propertyName: destPropName,
          unitAreaName: destUnitName,
          roomZoneName: destRoomName,
          surfaceTypeName: destSurfaceName,
          surfaceTypeId: destSurfaceId,
          recordStatus: setCurrent ? "CURRENT" : "DRAFT",
          effectiveFrom: setCurrent ? now : null,
          createdBy: actor.userId,
          createdByName: actor.username,
          updatedBy: actor.userId,
          updatedByName: actor.username,
          version: 1,
        });
        await copyDoc.save();
        createdCopies.push(copyDoc);

        // Copy photos
        const photos = await FinishRecordPhoto.find({ finishRecordId: finishRecord._id }).lean();
        if (photos.length > 0) {
          const photoCopies = photos.map((p) => ({
            ...p,
            _id: undefined,
            finishRecordId: copyDoc._id,
            uploadedBy: actor.userId,
            uploadedByName: actor.username,
          }));
          await FinishRecordPhoto.insertMany(photoCopies);
        }

        await recordAudit({
          finishRecordId: copyDoc._id,
          actorUserId: actor.userId,
          actorUsername: actor.username,
          action: "CREATE",
          beforeJson: null,
          afterJson: copyDoc.toObject(),
          source: req.headers["x-client-source"] || "web",
        });
      } else {
        // Create a reusable assignment
        if (setCurrent) {
          // Deactivate any existing current assignment for this target
          await FinishAssignment.updateMany(
            {
              propertyId: destPropId,
              surfaceTypeName: destSurfaceName,
              unitAreaName: destUnitName,
              roomZoneName: destRoomName,
              isCurrent: true,
            },
            { isCurrent: false, effectiveTo: now }
          );
        }

        const assign = await FinishAssignment.create({
          finishRecordId: finishRecord._id,
          propertyId: destPropId,
          propertyName: destPropName,
          buildingName: dest.buildingName || "",
          unitAreaName: destUnitName,
          roomZoneName: destRoomName,
          surfaceTypeId: destSurfaceId,
          surfaceTypeName: destSurfaceName,
          isCurrent: !!setCurrent,
          effectiveFrom: now,
          effectiveTo: null,
          createdBy: actor.userId,
          createdByName: actor.username,
        });

        createdAssignments.push(assign);
      }
    }

    await recordAudit({
      finishRecordId: finishRecord._id,
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: "ASSIGNMENT_ADD",
      beforeJson: null,
      afterJson: { appliedCount: destinations.length, makeIndependentCopies },
      source: req.headers["x-client-source"] || "web",
    });

    res.json({
      success: true,
      message: `Finish successfully applied to ${destinations.length} destination(s).`,
      assignmentsCount: createdAssignments.length,
      copiesCount: createdCopies.length,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PHOTO MANAGEMENT: Upload
// ---------------------------------------------------------------------------
router.post("/:id/photos", requireAuth, upload.array("photos", 10), async (req, res, next) => {
  try {
    const actor = getActorInfo(req);
    if (!canEditFinishes(actor.role)) {
      return res.status(403).json({ error: { message: "You are not authorized to upload photos." } });
    }

    const record = await FinishRecord.findById(req.params.id);
    if (!record) {
      return res.status(404).json({ error: { message: "Finish record not found." } });
    }

    const files = req.files || [];
    const photoType = req.body.photoType || "paint_can";
    const caption = req.body.caption || "";

    // Also support base64 image data payload if passed in body
    const base64Data = req.body.photoDataUrl;
    const addedPhotos = [];

    if (base64Data && typeof base64Data === "string" && base64Data.startsWith("data:image")) {
      const matches = base64Data.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
      if (matches) {
        const mimeType = matches[1];
        const buffer = Buffer.from(matches[2], "base64");
        const ext = mimeType.split("/")[1] || "jpg";
        const filename = `${Date.now()}_camera.${ext}`;
        const filePath = path.join(uploadsDir, filename);
        fs.writeFileSync(filePath, buffer);

        const fileUrl = `/uploads/finishes/${filename}`;
        const photo = await FinishRecordPhoto.create({
          finishRecordId: record._id,
          photoType,
          fileUrl,
          thumbnailUrl: fileUrl,
          caption,
          sortOrder: (await FinishRecordPhoto.countDocuments({ finishRecordId: record._id })) + 1,
          uploadedBy: actor.userId,
          uploadedByName: actor.username,
          metadata: {
            fileSize: buffer.length,
            mimeType,
            originalName: filename,
          },
        });
        addedPhotos.push(photo);
      }
    }

    if (files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileUrl = `/uploads/finishes/${file.filename}`;
        const photo = await FinishRecordPhoto.create({
          finishRecordId: record._id,
          photoType: req.body[`photoType_${i}`] || photoType,
          fileUrl,
          thumbnailUrl: fileUrl,
          caption: req.body[`caption_${i}`] || caption,
          sortOrder: (await FinishRecordPhoto.countDocuments({ finishRecordId: record._id })) + i + 1,
          uploadedBy: actor.userId,
          uploadedByName: actor.username,
          metadata: {
            fileSize: file.size,
            mimeType: file.mimetype,
            originalName: file.originalname,
          },
        });
        addedPhotos.push(photo);
      }
    }

    if (addedPhotos.length === 0) {
      return res.status(400).json({ error: { message: "No valid photo files were provided." } });
    }

    await recordAudit({
      finishRecordId: record._id,
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: "PHOTO_ADD",
      beforeJson: null,
      afterJson: { addedCount: addedPhotos.length, photoType },
      source: req.headers["x-client-source"] || "web",
    });

    res.status(201).json({
      success: true,
      photos: addedPhotos,
    });
  } catch (err) {
    next(err);
  }
});

// PHOTO MANAGEMENT: Delete photo
router.delete("/:id/photos/:photoId", requireAuth, async (req, res, next) => {
  try {
    const actor = getActorInfo(req);
    if (!canEditFinishes(actor.role)) {
      return res.status(403).json({ error: { message: "You are not authorized to delete photos." } });
    }

    const photo = await FinishRecordPhoto.findOne({
      _id: req.params.photoId,
      finishRecordId: req.params.id,
    });

    if (!photo) {
      return res.status(404).json({ error: { message: "Photo not found." } });
    }

    const beforeJson = photo.toObject();
    await FinishRecordPhoto.findByIdAndDelete(photo._id);

    await recordAudit({
      finishRecordId: req.params.id,
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: "PHOTO_DELETE",
      beforeJson,
      afterJson: null,
      source: req.headers["x-client-source"] || "web",
    });

    res.json({ success: true, message: "Photo removed successfully." });
  } catch (err) {
    next(err);
  }
});

// PHOTO MANAGEMENT: Update photo metadata (caption, type, sort)
router.patch("/:id/photos/:photoId", requireAuth, async (req, res, next) => {
  try {
    const actor = getActorInfo(req);
    if (!canEditFinishes(actor.role)) {
      return res.status(403).json({ error: { message: "You are not authorized to update photos." } });
    }

    const photo = await FinishRecordPhoto.findOne({
      _id: req.params.photoId,
      finishRecordId: req.params.id,
    });

    if (!photo) {
      return res.status(404).json({ error: { message: "Photo not found." } });
    }

    if (req.body.caption !== undefined) photo.caption = req.body.caption;
    if (req.body.photoType !== undefined) photo.photoType = req.body.photoType;
    if (req.body.sortOrder !== undefined) photo.sortOrder = Number(req.body.sortOrder);

    await photo.save();

    res.json({ success: true, photo });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// AUDIT & VERSION HISTORY
// ---------------------------------------------------------------------------
router.get("/:id/history", requireAuth, async (req, res, next) => {
  try {
    const audits = await FinishRecordAudit.find({ finishRecordId: req.params.id })
      .sort({ createdAt: -1 })
      .lean();

    const record = await FinishRecord.findById(req.params.id).lean();
    let previousVersions = [];

    if (record) {
      previousVersions = await FinishRecord.find({
        propertyId: record.propertyId,
        surfaceTypeName: record.surfaceTypeName,
        unitAreaName: record.unitAreaName,
        _id: { $ne: record._id },
      })
        .sort({ effectiveTo: -1, createdAt: -1 })
        .lean();
    }

    res.json({
      success: true,
      audits,
      previousVersions: previousVersions.map((v) => ({ ...v, id: String(v._id) })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

