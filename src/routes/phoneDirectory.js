const express = require("express");
const { z } = require("zod");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const PhoneDirectory = require("../models/PhoneDirectory");
const Location = require("../models/Location");
const ActivityLog = require("../models/ActivityLog");
const User = require("../models/User");
const Employee = require("../models/Employee");
const { encryptField, decryptField } = require("../utils/encryption");
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

// Sanitization helper: Protect sensitive bank information. Only Super Admin has access,
// and the raw account number is kept masked until verified with password reveal.
function formatDirectoryContact(doc, isSuperAdmin) {
  const base = {
    ...doc,
    id: String(doc._id),
    location: doc.locationId || null,
  };

  // Strip cryptographic secrets
  delete base.bankPasswordHash;
  delete base.accountNumberEncrypted;

  if (!isSuperAdmin) {
    // Non-super-admins cannot see any bank details
    delete base.bankName;
    delete base.accountNo;
    delete base.accountNumberMasked;
    base.hasBankDetails = false;
  } else {
    // Super-admins see bank name and masked account number
    base.hasBankDetails = Boolean(doc.bankName || doc.accountNumberMasked || doc.accountNumberEncrypted);
    base.bankName = doc.bankName || "";
    base.accountNumberMasked = doc.accountNumberMasked || (doc.accountNumberEncrypted ? "••••••••" : "");
    // Raw plain accountNo is NOT exposed in general queries; requires /reveal-bank endpoint
    delete base.accountNo;
  }

  return base;
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
  bankName: z.string().optional().default(""),
  accountNo: z.string().optional().default(""),
  bankPassword: z.string().optional().default(""),
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

    const isSuperAdmin = req.user?.role === "super-admin";
    const formatted = items.map((doc) => formatDirectoryContact(doc, isSuperAdmin));

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

    const isSuperAdmin = req.user?.role === "super-admin";
    res.json({
      items: items.map((doc) => formatDirectoryContact(doc, isSuperAdmin)),
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
    const isSuperAdmin = req.user?.role === "super-admin";
    res.json({ item: formatDirectoryContact(item, isSuperAdmin) });
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
    const isSuperAdmin = req.user?.role === "super-admin";

    // Banking Details authorization check
    if (data.bankName || data.accountNo || data.bankPassword) {
      if (!isSuperAdmin) {
        return res.status(403).json({
          error: { message: "Access denied. Only Super Admin can configure bank account details." },
        });
      }
    }

    // Process Bank & Account Information
    if (isSuperAdmin && data.accountNo && String(data.accountNo).trim()) {
      const raw = String(data.accountNo).trim();
      data.accountNo = ""; // Never store plain account number in plain text
      data.accountNumberMasked = raw.length > 4 ? `•••• ${raw.slice(-4)}` : "••••••••";
      try {
        data.accountNumberEncrypted = encryptField(raw);
      } catch (encErr) {
        console.error("Encryption error for accountNo:", encErr.message);
        data.accountNumberEncrypted = "";
      }
      data.hasBankDetails = true;
    } else {
      data.accountNo = "";
      data.accountNumberMasked = "";
      data.accountNumberEncrypted = "";
      data.hasBankDetails = isSuperAdmin ? Boolean(data.bankName && data.bankName.trim()) : false;
    }

    if (isSuperAdmin && data.bankPassword && String(data.bankPassword).trim()) {
      data.bankPasswordHash = await bcrypt.hash(String(data.bankPassword).trim(), 10);
    }
    delete data.bankPassword;

    if (!isSuperAdmin) {
      delete data.bankName;
      delete data.accountNo;
      delete data.accountNumberMasked;
      delete data.accountNumberEncrypted;
      delete data.bankPasswordHash;
      data.hasBankDetails = false;
    }

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
      `Created directory contact "${created.name}" (${created.category}: ${created.phoneNumber})${
        created.hasBankDetails ? " [Includes Protected Banking Details]" : ""
      }`
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

    res.status(201).json({ item: formatDirectoryContact(populated, isSuperAdmin) });
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
    const isSuperAdmin = req.user?.role === "super-admin";

    // Restrict editing bank information to super-admin
    if (
      (data.bankName !== undefined && data.bankName !== "") ||
      (data.accountNo !== undefined && data.accountNo !== "") ||
      data.bankPassword !== undefined
    ) {
      if (!isSuperAdmin) {
        return res.status(403).json({
          error: { message: "Access denied. Only Super Admin can edit bank account details." },
        });
      }
    }

    // Process Bank & Account Information
    if (data.accountNo !== undefined) {
      if (!isSuperAdmin) {
        delete data.accountNo;
      } else if (data.accountNo && String(data.accountNo).trim()) {
        const raw = String(data.accountNo).trim();
        data.accountNo = "";
        data.accountNumberMasked = raw.length > 4 ? `•••• ${raw.slice(-4)}` : "••••••••";
        try {
          data.accountNumberEncrypted = encryptField(raw);
        } catch (encErr) {
          console.error("Encryption error for accountNo:", encErr.message);
          data.accountNumberEncrypted = "";
        }
        data.hasBankDetails = true;
      } else {
        // Explicitly cleared
        data.accountNo = "";
        data.accountNumberMasked = "";
        data.accountNumberEncrypted = "";
        data.hasBankDetails = Boolean(data.bankName && String(data.bankName).trim());
      }
    }

    if (data.bankPassword !== undefined) {
      if (isSuperAdmin && String(data.bankPassword).trim()) {
        data.bankPasswordHash = await bcrypt.hash(String(data.bankPassword).trim(), 10);
      } else if (isSuperAdmin && data.bankPassword === "") {
        data.bankPasswordHash = "";
      }
      delete data.bankPassword;
    }

    if (!isSuperAdmin) {
      delete data.bankName;
      delete data.accountNo;
      delete data.accountNumberMasked;
      delete data.accountNumberEncrypted;
      delete data.bankPasswordHash;
    }

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

    res.json({ item: formatDirectoryContact(updated, isSuperAdmin) });
  } catch (err) {
    next(err);
  }
});

// POST /api/phone-directory/:id/reveal-bank - Step-Up Reveal Bank Details (Password Protected - Super Admin Only)
router.post("/:id/reveal-bank", requireAuth, async (req, res, next) => {
  try {
    if (req.user?.role !== "super-admin") {
      return res.status(403).json({
        error: { message: "Access denied. Only Super Admin is authorized to reveal banking details." },
      });
    }

    const { password } = req.body;
    if (!password || !String(password).trim()) {
      return res.status(400).json({
        error: { message: "Administrator password is required to reveal banking details." },
      });
    }

    const contact = await PhoneDirectory.findById(req.params.id);
    if (!contact) {
      return res.status(404).json({ error: { message: "Phone directory entry not found." } });
    }

    // Verify requesting Super Admin's password
    const actorUserId = req.user.sub || req.user.id || req.user._id;
    let actorUser = await User.findById(actorUserId);
    if (!actorUser) {
      actorUser = await Employee.findById(actorUserId);
    }

    let passwordMatch = false;
    if (actorUser && actorUser.passwordHash) {
      passwordMatch = await bcrypt.compare(String(password).trim(), actorUser.passwordHash);
    }

    // Also accept entry-specific custom bank protection password if one was set
    if (!passwordMatch && contact.bankPasswordHash) {
      passwordMatch = await bcrypt.compare(String(password).trim(), contact.bankPasswordHash);
    }

    if (!passwordMatch) {
      await ActivityLog.create({
        actorUserId: String(actorUserId),
        actorUsername: req.user.name || req.user.username || "Super Admin",
        actorRole: req.user.role,
        action: "PHONE_DIRECTORY_BANK_REVEAL_FAILED",
        resourceType: "phone_directory",
        resourceId: String(contact._id),
        resourceName: contact.name,
        description: `Failed password verification when attempting to reveal banking details for "${contact.name}"`,
      }).catch(() => {});

      return res.status(403).json({
        error: { message: "Invalid password. Access denied." },
      });
    }

    // Decrypt account number
    let decryptedAccountNo = "";
    if (contact.accountNumberEncrypted) {
      try {
        decryptedAccountNo = decryptField(contact.accountNumberEncrypted);
      } catch (decErr) {
        console.error("Decryption failed for contact bank account:", decErr.message);
        decryptedAccountNo = contact.accountNo || "";
      }
    } else if (contact.accountNo) {
      decryptedAccountNo = contact.accountNo;
    }

    await ActivityLog.create({
      actorUserId: String(actorUserId),
      actorUsername: req.user.name || req.user.username || "Super Admin",
      actorRole: req.user.role,
      action: "PHONE_DIRECTORY_BANK_REVEAL_SUCCESS",
      resourceType: "phone_directory",
      resourceId: String(contact._id),
      resourceName: contact.name,
      description: `Super Admin revealed protected bank account details for "${contact.name}"`,
    }).catch(() => {});

    return res.json({
      bankName: contact.bankName || "",
      accountNo: decryptedAccountNo,
      accountNumberMasked: contact.accountNumberMasked || (decryptedAccountNo ? `•••• ${decryptedAccountNo.slice(-4)}` : ""),
      revealedAt: new Date().toISOString(),
    });
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
