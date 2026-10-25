const express = require("express");
const { z } = require("zod");
const mongoose = require("mongoose");

const PhoneDirectory = require("../models/PhoneDirectory");
const Location = require("../models/Location");
const ActivityLog = require("../models/ActivityLog");
const { createNotification } = require("../utils/notifications");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

async function logActivity(req, action, resourceId, resourceName, description) {
  try {
    await ActivityLog.create({
      actorUserId: String(req.user?.sub || req.user?.id || ""),
      actorUsername: String(req.user?.username || req.user?.name || "unknown"),
      actorRole: String(req.user?.role || "unknown"),
      action,
      resourceType: "phone_directory",
      resourceId: String(resourceId),
      resourceName: String(resourceName),
      description: description || `${action} on phone directory`,
      ipAddress: String(req.ip || req.headers["x-forwarded-for"] || ""),
      userAgent: String(req.headers["user-agent"] || ""),
    });
  } catch (err) {
    console.error("PhoneDirectory activity log error:", err.message);
  }
}

const CATEGORIES = [
  "Fire Brigade",
  "Police",
  "Medical / Ambulance",
  "Hospital",
  "Security",
  "Utility",
  "Municipal / Government",
  "Maintenance / Contractor",
  "Tow / Roadside",
  "Emergency Management",
  "Other",
];

const phoneDirectorySchema = z.object({
  name: z.string().min(1, "Name is required"),
  category: z.enum([
    "Fire Brigade",
    "Police",
    "Medical / Ambulance",
    "Hospital",
    "Security",
    "Utility",
    "Municipal / Government",
    "Maintenance / Contractor",
    "Tow / Roadside",
    "Emergency Management",
    "Other",
  ]),
  phoneNumber: z.string().min(1, "Phone number is required"),
  secondaryPhone: z.string().optional().default(""),
  extension: z.string().optional().default(""),
  contactPerson: z.string().optional().default(""),
  email: z.union([z.string().email(), z.literal("")]).optional().default(""),
  address: z.string().optional().default(""),
  locationId: z.string().nullable().optional().default(null),
  locationName: z.string().optional().default(""),
  isAllLocations: z.boolean().optional().default(false),
  priority: z.enum(["emergency", "high", "standard"]).optional().default("standard"),
  status: z.enum(["active", "inactive"]).optional().default("active"),
  operatingHours: z.string().optional().default("24/7"),
  notes: z.string().optional().default(""),
});

const updatePhoneDirectorySchema = phoneDirectorySchema.partial();

// GET all phone directory entries with filters
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const {
      search,
      name,
      number,
      phoneNumber,
      locationId,
      category,
      priority,
      status,
      includeAllLocations,
    } = req.query;

    const query = {};

    // Specific status filter (default: active if not specified, or allow all)
    if (status && status !== "all") {
      query.status = status;
    }

    // Category filter
    if (category && category !== "all") {
      query.category = category;
    }

    // Priority filter
    if (priority && priority !== "all") {
      query.priority = priority;
    }

    // Name filter
    if (name) {
      query.name = { $regex: String(name).trim(), $options: "i" };
    }

    // Number filter (matches primary or secondary phone or extension)
    const phoneFilter = number || phoneNumber;
    if (phoneFilter) {
      const cleanDigits = String(phoneFilter).trim().replace(/[^\d+]/g, "");
      const regexStr = String(phoneFilter).trim();
      query.$or = [
        { phoneNumber: { $regex: regexStr, $options: "i" } },
        { secondaryPhone: { $regex: regexStr, $options: "i" } },
        { extension: { $regex: regexStr, $options: "i" } },
      ];
      if (cleanDigits.length > 2) {
        query.$or.push({ phoneNumber: { $regex: cleanDigits, $options: "i" } });
      }
    }

    // Location filter
    if (locationId && locationId !== "all") {
      if (locationId === "global" || locationId === "all_locations") {
        query.isAllLocations = true;
      } else {
        const isValidObjectId = mongoose.Types.ObjectId.isValid(locationId);
        if (isValidObjectId) {
          const locObjId = new mongoose.Types.ObjectId(locationId);
          if (includeAllLocations === "true" || includeAllLocations === true) {
            query.$or = [
              ...(query.$or || []),
              { locationId: locObjId },
              { isAllLocations: true },
            ];
          } else {
            query.locationId = locObjId;
          }
        } else {
          // If locationId was passed as a name string
          query.locationName = { $regex: String(locationId).trim(), $options: "i" };
        }
      }
    }

    // Unified general search filter
    if (search && String(search).trim()) {
      const s = String(search).trim();
      const sRegex = { $regex: s, $options: "i" };
      const searchConditions = [
        { name: sRegex },
        { phoneNumber: sRegex },
        { secondaryPhone: sRegex },
        { contactPerson: sRegex },
        { category: sRegex },
        { locationName: sRegex },
        { notes: sRegex },
        { address: sRegex },
      ];

      if (query.$or) {
        query.$and = [{ $or: query.$or }, { $or: searchConditions }];
        delete query.$or;
      } else {
        query.$or = searchConditions;
      }
    }

    // Fetch items with location population
    const items = await PhoneDirectory.find(query)
      .populate("locationId", "name city address type phone manager status")
      .sort({
        // Priority custom order: emergency first, then high, then standard
        priority: 1,
        name: 1,
      })
      .lean();

    // Custom sort to guarantee emergency > high > standard
    const priorityWeight = { emergency: 0, high: 1, standard: 2 };
    items.sort((a, b) => {
      const pa = priorityWeight[a.priority] ?? 2;
      const pb = priorityWeight[b.priority] ?? 2;
      if (pa !== pb) return pa - pb;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });

    const formatted = items.map((doc) => ({
      ...doc,
      id: String(doc._id),
      location: doc.locationId || null,
    }));

    res.json({ items: formatted });
  } catch (err) {
    next(err);
  }
});

// GET contacts attached to a specific location (including global ones)
router.get("/by-location/:locationId", requireAuth, async (req, res, next) => {
  try {
    const { locationId } = req.params;
    const isValidObjectId = mongoose.Types.ObjectId.isValid(locationId);

    const matchQuery = {
      status: "active",
      $or: [{ isAllLocations: true }],
    };

    if (isValidObjectId) {
      matchQuery.$or.push({ locationId: new mongoose.Types.ObjectId(locationId) });
    }

    const items = await PhoneDirectory.find(matchQuery)
      .populate("locationId", "name city address type phone")
      .sort({ priority: 1, name: 1 })
      .lean();

    const priorityWeight = { emergency: 0, high: 1, standard: 2 };
    items.sort((a, b) => {
      const pa = priorityWeight[a.priority] ?? 2;
      const pb = priorityWeight[b.priority] ?? 2;
      if (pa !== pb) return pa - pb;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });

    res.json({
      items: items.map((doc) => ({
        ...doc,
        id: String(doc._id),
        location: doc.locationId || null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// GET single phone directory entry
router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const item = await PhoneDirectory.findById(req.params.id)
      .populate("locationId", "name city address type phone")
      .lean();
    if (!item) {
      return res.status(404).json({ error: { message: "Phone directory entry not found" } });
    }
    res.json({ item: { ...item, id: String(item._id) } });
  } catch (err) {
    next(err);
  }
});

// POST create phone directory entry
router.post("/", requireAuth, async (req, res, next) => {
  try {
    const parsed = phoneDirectorySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: {
          message: "Validation failed",
          details: parsed.error.errors,
        },
      });
    }

    const data = { ...parsed.data };

    // Resolve location name if locationId provided
    if (data.isAllLocations) {
      data.locationId = null;
      data.locationName = "All Locations (Global)";
    } else if (data.locationId && mongoose.Types.ObjectId.isValid(data.locationId)) {
      const loc = await Location.findById(data.locationId).select("name city").lean();
      if (loc) {
        data.locationName = loc.city ? `${loc.name} (${loc.city})` : loc.name;
      }
    } else {
      data.locationId = null;
      if (!data.locationName) data.locationName = "Unassigned";
    }

    data.createdBy = req.user?.username || req.user?.name || "Admin";

    const created = await PhoneDirectory.create(data);
    const populated = await PhoneDirectory.findById(created._id)
      .populate("locationId", "name city address type phone")
      .lean();

    // Log activity
    await logActivity(
      req,
      "PHONE_DIRECTORY_CREATE",
      created._id,
      created.name,
      `Created directory contact "${created.name}" (${created.category}: ${created.phoneNumber})`
    );

    // Create notification
    await createNotification({
      actor: req.user?.name || req.user?.username || "Admin",
      actorRole: req.user?.role || "admin",
      action: "created",
      resourceType: "phone_directory",
      resourceName: created.name,
      details: `${created.category}: ${created.phoneNumber} (${data.locationName})`,
      resourceId: String(created._id),
    });

    res.status(201).json({ item: { ...populated, id: String(populated._id) } });
  } catch (err) {
    next(err);
  }
});

// PUT update phone directory entry
router.put("/:id", requireAuth, async (req, res, next) => {
  try {
    const parsed = updatePhoneDirectorySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: {
          message: "Validation failed",
          details: parsed.error.errors,
        },
      });
    }

    const data = { ...parsed.data };

    // Update location name if location changed
    if (data.isAllLocations) {
      data.locationId = null;
      data.locationName = "All Locations (Global)";
    } else if (data.locationId !== undefined) {
      if (data.locationId && mongoose.Types.ObjectId.isValid(data.locationId)) {
        const loc = await Location.findById(data.locationId).select("name city").lean();
        if (loc) {
          data.locationName = loc.city ? `${loc.name} (${loc.city})` : loc.name;
        }
      } else {
        data.locationId = null;
        if (!data.locationName) data.locationName = "Unassigned";
      }
    }

    const updated = await PhoneDirectory.findByIdAndUpdate(req.params.id, data, {
      new: true,
      runValidators: true,
    })
      .populate("locationId", "name city address type phone")
      .lean();

    if (!updated) {
      return res.status(404).json({ error: { message: "Phone directory entry not found" } });
    }

    await logActivity(
      req,
      "PHONE_DIRECTORY_UPDATE",
      updated._id,
      updated.name,
      `Updated directory contact "${updated.name}"`
    );

    res.json({ item: { ...updated, id: String(updated._id) } });
  } catch (err) {
    next(err);
  }
});

// DELETE phone directory entry
router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const existing = await PhoneDirectory.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: { message: "Phone directory entry not found" } });
    }

    await PhoneDirectory.findByIdAndDelete(req.params.id);

    await logActivity(
      req,
      "PHONE_DIRECTORY_DELETE",
      existing._id,
      existing.name,
      `Deleted directory contact "${existing.name}" (${existing.phoneNumber})`
    );

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST seed default emergency & utility contacts
router.post("/seed-defaults", requireAuth, async (req, res, next) => {
  try {
    const count = await PhoneDirectory.countDocuments();
    // Fetch first available location if any to demonstrate association
    const sampleLoc = await Location.findOne({ status: "active" }).select("_id name city").lean();

    const defaults = [
      {
        name: "Emergency Dispatch (Police / Fire / EMS)",
        category: "Emergency Management",
        phoneNumber: "911",
        secondaryPhone: "",
        isAllLocations: true,
        locationName: "All Locations (Global)",
        priority: "emergency",
        status: "active",
        operatingHours: "24/7",
        notes: "National emergency hotline for immediate life-threatening situations.",
      },
      {
        name: "Central Fire Brigade & Rescue",
        category: "Fire Brigade",
        phoneNumber: "(555) 019-9347",
        secondaryPhone: "(555) 019-9348",
        extension: "102",
        contactPerson: "Chief R. Gallagher",
        address: "450 Firehouse Way",
        locationId: sampleLoc ? sampleLoc._id : null,
        locationName: sampleLoc ? `${sampleLoc.name} (${sampleLoc.city})` : "All Locations (Global)",
        isAllLocations: !sampleLoc,
        priority: "emergency",
        status: "active",
        operatingHours: "24/7 Emergency Response",
        notes: "Direct line to local fire station and hazmat squad.",
      },
      {
        name: "Metropolitan Police Department",
        category: "Police",
        phoneNumber: "(555) 018-8200",
        secondaryPhone: "(555) 018-8201",
        contactPerson: "Desk Sergeant Morales",
        address: "100 Civic Center Plaza",
        locationId: sampleLoc ? sampleLoc._id : null,
        locationName: sampleLoc ? `${sampleLoc.name} (${sampleLoc.city})` : "All Locations (Global)",
        isAllLocations: !sampleLoc,
        priority: "emergency",
        status: "active",
        operatingHours: "24/7 Precinct Dispatch",
        notes: "Non-emergency dispatch line and commercial security coordination.",
      },
      {
        name: "St. Jude Memorial Hospital - Trauma Center",
        category: "Hospital",
        phoneNumber: "(555) 014-4900",
        secondaryPhone: "(555) 014-4911",
        extension: "Emergency ER",
        contactPerson: "Dr. Evelyn Reed",
        address: "700 Health Sciences Blvd",
        locationId: sampleLoc ? sampleLoc._id : null,
        locationName: sampleLoc ? `${sampleLoc.name} (${sampleLoc.city})` : "All Locations (Global)",
        isAllLocations: !sampleLoc,
        priority: "emergency",
        status: "active",
        operatingHours: "24/7 Level 1 Trauma",
        notes: "Nearest emergency medical center and acute care unit.",
      },
      {
        name: "Poison Control National Hotline",
        category: "Medical / Ambulance",
        phoneNumber: "1-800-222-1222",
        isAllLocations: true,
        locationName: "All Locations (Global)",
        priority: "high",
        status: "active",
        operatingHours: "24/7",
        notes: "Expert medical advice for hazardous chemical and toxic exposure.",
      },
      {
        name: "City Power & Gas Emergency Leak Line",
        category: "Utility",
        phoneNumber: "(555) 012-3400",
        secondaryPhone: "1-800-555-LEAK",
        contactPerson: "Dispatch Officer Vance",
        locationId: sampleLoc ? sampleLoc._id : null,
        locationName: sampleLoc ? `${sampleLoc.name} (${sampleLoc.city})` : "All Locations (Global)",
        isAllLocations: !sampleLoc,
        priority: "high",
        status: "active",
        operatingHours: "24/7 Utility Emergency",
        notes: "Report gas leaks, downed electric power lines, or water main breaks immediately.",
      },
      {
        name: "Facility Security & Night Patrol",
        category: "Security",
        phoneNumber: "(555) 017-7001",
        secondaryPhone: "(555) 017-7002",
        extension: "Desk 4",
        contactPerson: "Captain Dave Miller",
        locationId: sampleLoc ? sampleLoc._id : null,
        locationName: sampleLoc ? `${sampleLoc.name} (${sampleLoc.city})` : "All Locations (Global)",
        isAllLocations: !sampleLoc,
        priority: "high",
        status: "active",
        operatingHours: "6:00 PM - 6:00 AM Daily",
        notes: "On-site guard patrol, alarm verification, and gate access control.",
      },
    ];

    const inserted = await PhoneDirectory.insertMany(
      defaults.map((d) => ({
        ...d,
        createdBy: req.user?.username || "System Setup",
      }))
    );

    res.json({
      message: `Seeded ${inserted.length} default emergency & service contacts`,
      items: inserted,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
