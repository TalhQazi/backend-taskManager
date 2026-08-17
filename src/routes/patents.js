const express = require("express");
const Patent = require("../models/Patent");
const Employee = require("../models/Employee");
const User = require("../models/User");
const SystemSettings = require("../models/SystemSettings");
const { sendSystemEmail, sendRawEmail } = require("../lib/email");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// Helper function to calculate expiration, honoring custom override if provided
const calculateExpiration = (filingDate, filingType, customExpiration = null) => {
  if (customExpiration) {
    const customDate = new Date(customExpiration);
    if (!isNaN(customDate.getTime())) return customDate;
  }
  if (!filingDate) return null;
  const date = new Date(filingDate);
  if (filingType === "Provisional") {
    date.setFullYear(date.getFullYear() + 1);
  } else {
    date.setFullYear(date.getFullYear() + 20);
  }
  return date;
};

// Helper function to check if expiring soon (<= 60 days)
const isExpiringExpiringSoon = (expirationDate) => {
  if (!expirationDate) return false;
  const today = new Date();
  const daysUntilExpiration = Math.ceil(
    (new Date(expirationDate) - today) / (1000 * 60 * 60 * 24)
  );
  return daysUntilExpiration <= 60 && daysUntilExpiration > 0;
};

// Helper to notify all active Admins & Super-Admins when a patent is filed
async function notifyAdminsAboutFiledPatent(patent) {
  try {
    const expiration = calculateExpiration(patent.filingDate, patent.filingType, patent.provisionalExpiration);
    const expirationStr = expiration ? expiration.toISOString().split("T")[0] : "N/A";
    const filingDateStr = patent.filingDate ? new Date(patent.filingDate).toISOString().split("T")[0] : "N/A";

    const empAdmins = await Employee.find({
      userRole: { $in: ["admin", "super-admin"] },
      userStatus: "active",
      email: { $exists: true, $ne: "" },
    }).select("email name").lean();

    const userAdmins = await User.find({
      role: { $in: ["admin", "super-admin"] },
      status: "active",
      email: { $exists: true, $ne: "" },
    }).select("email name").lean();

    const recipientMap = new Map();
    empAdmins.forEach((e) => { if (e.email) recipientMap.set(e.email.toLowerCase(), e.name || "Admin"); });
    userAdmins.forEach((u) => { if (u.email) recipientMap.set(u.email.toLowerCase(), u.name || "Admin"); });

    for (const [email, name] of recipientMap.entries()) {
      await sendSystemEmail({
        to: email,
        templateKey: "patentFiled",
        variables: {
          name,
          patentName: patent.patentName || "N/A",
          filingType: patent.filingType || "Provisional",
          filingDate: filingDateStr,
          expirationDate: expirationStr,
          applicationNumber: patent.applicationNumber || "N/A",
          category: patent.category || "N/A",
          notes: patent.notes || "None",
          createdBy: patent.createdBy || "System",
        },
      });
    }
  } catch (err) {
    console.error("[Patents Route] Error notifying admins about filed patent:", err);
  }
}

// Get expiration watch (patents expiring within 180 days) - MUST come before /:id route
router.get("/expiration-watch", async (req, res, next) => {
  try {
    const patents = await Patent.find({ patentType: "filed" })
      .sort({ filingDate: 1 })
      .lean();

    const today = new Date();
    const expiringPatents = patents
      .map((patent) => {
        const expiration = calculateExpiration(patent.filingDate, patent.filingType, patent.provisionalExpiration);
        if (!expiration) return null;

        const daysUntilExpiration = Math.ceil(
          (expiration - today) / (1000 * 60 * 60 * 24)
        );

        return {
          ...patent,
          provisionalExpiration: expiration,
          daysUntilExpiration,
        };
      })
      .filter(
        (patent) =>
          patent &&
          patent.daysUntilExpiration >= 0 &&
          patent.daysUntilExpiration <= 180
      )
      .sort((a, b) => a.daysUntilExpiration - b.daysUntilExpiration);

    res.json({ items: expiringPatents });
  } catch (err) {
    next(err);
  }
});

// Get all filed patents
router.get("/filed", async (req, res, next) => {
  try {
    const patents = await Patent.find({ patentType: "filed" })
      .sort({ patentName: 1 })
      .lean();

    const enrichedPatents = patents.map((patent) => {
      const expiration = calculateExpiration(patent.filingDate, patent.filingType, patent.provisionalExpiration);
      const isExpiring = isExpiringExpiringSoon(expiration);

      return {
        ...patent,
        provisionalExpiration: expiration,
        isExpiringExpiringSoon: isExpiring,
      };
    });

    res.json({ items: enrichedPatents });
  } catch (err) {
    next(err);
  }
});

// Get all pending patents
router.get("/pending", async (req, res, next) => {
  try {
    const patents = await Patent.find({ patentType: "pending" })
      .sort({ patentName: 1 })
      .lean();
    res.json({ items: patents });
  } catch (err) {
    next(err);
  }
});

// Get single patent by ID
router.get("/:id", async (req, res, next) => {
  try {
    const patent = await Patent.findById(req.params.id).lean();
    if (!patent) {
      return res.status(404).json({ error: { message: "Patent not found" } });
    }

    if (patent.patentType === "filed") {
      const expiration = calculateExpiration(patent.filingDate, patent.filingType, patent.provisionalExpiration);
      return res.json({
        item: {
          ...patent,
          provisionalExpiration: expiration,
          isExpiringExpiringSoon: isExpiringExpiringSoon(expiration),
        },
      });
    }

    res.json({ item: patent });
  } catch (err) {
    next(err);
  }
});

// Check patent expirations manually / on-demand
router.post("/check-expirations", requireAuth, async (req, res, next) => {
  try {
    const { checkPatentExpirations } = require("../jobs/expiryJob");
    const results = await checkPatentExpirations(true);
    res.json({ message: "Patent expiration check completed", ...results });
  } catch (err) {
    next(err);
  }
});

// ── Sub-path aliases used by the frontend (/filed/:id, /pending/:id) ──

router.post("/filed", requireAuth, async (req, res, next) => {
  req.body.patentType = "filed";
  try {
    const { patentName } = req.body;
    if (!patentName) return res.status(400).json({ error: { message: "patentName is required" } });
    
    if (!req.body.provisionalExpiration && req.body.filingDate) {
      req.body.provisionalExpiration = calculateExpiration(req.body.filingDate, req.body.filingType);
    }

    const newPatent = new Patent({ ...req.body, createdBy: req.user?.username || "System" });
    await newPatent.save();

    notifyAdminsAboutFiledPatent(newPatent);

    // Also trigger expiration check in background if filed within alert window
    const { checkPatentExpirations } = require("../jobs/expiryJob");
    checkPatentExpirations().catch((e) => console.error("Auto expiry check failed:", e));

    res.status(201).json({ item: newPatent });
  } catch (err) { next(err); }
});

router.post("/pending", requireAuth, async (req, res, next) => {
  req.body.patentType = "pending";
  try {
    const { patentName } = req.body;
    if (!patentName) return res.status(400).json({ error: { message: "patentName is required" } });
    const newPatent = new Patent({ ...req.body, createdBy: req.user?.username || "System" });
    await newPatent.save();
    res.status(201).json({ item: newPatent });
  } catch (err) { next(err); }
});

router.put("/filed/:id", requireAuth, async (req, res, next) => {
  try {
    if (req.body.filingDate && !req.body.provisionalExpiration) {
      req.body.provisionalExpiration = calculateExpiration(req.body.filingDate, req.body.filingType);
    }
    const patent = await Patent.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!patent) return res.status(404).json({ error: { message: "Patent not found" } });
    const expiration = calculateExpiration(patent.filingDate, patent.filingType, patent.provisionalExpiration);

    // Trigger expiration check in background
    const { checkPatentExpirations } = require("../jobs/expiryJob");
    checkPatentExpirations().catch((e) => console.error("Auto expiry check failed:", e));

    res.json({ item: { ...patent.toObject(), provisionalExpiration: expiration, isExpiringExpiringSoon: isExpiringExpiringSoon(expiration) } });
  } catch (err) { next(err); }
});

router.put("/pending/:id", requireAuth, async (req, res, next) => {
  try {
    const patent = await Patent.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!patent) return res.status(404).json({ error: { message: "Patent not found" } });
    res.json({ item: patent });
  } catch (err) { next(err); }
});

router.delete("/filed/:id", requireAuth, async (req, res, next) => {
  try {
    const patent = await Patent.findByIdAndDelete(req.params.id);
    if (!patent) return res.status(404).json({ error: { message: "Patent not found" } });
    res.json({ message: "Patent deleted successfully" });
  } catch (err) { next(err); }
});

router.delete("/pending/:id", requireAuth, async (req, res, next) => {
  try {
    const patent = await Patent.findByIdAndDelete(req.params.id);
    if (!patent) return res.status(404).json({ error: { message: "Patent not found" } });
    res.json({ message: "Patent deleted successfully" });
  } catch (err) { next(err); }
});

// ── Generic routes ──

// Create new patent (requires auth)
router.post("/", requireAuth, async (req, res, next) => {
  try {
    const { patentName, patentType, ...rest } = req.body;

    if (!patentName || !patentType) {
      return res.status(400).json({
        error: { message: "patentName and patentType are required" },
      });
    }

    if (patentType === "filed" && !rest.provisionalExpiration && rest.filingDate) {
      rest.provisionalExpiration = calculateExpiration(rest.filingDate, rest.filingType);
    }

    const newPatent = new Patent({
      patentName,
      patentType,
      ...rest,
      createdBy: req.user?.username || "System",
    });

    await newPatent.save();

    if (patentType === "filed") {
      notifyAdminsAboutFiledPatent(newPatent);
    }

    res.status(201).json({ item: newPatent });
  } catch (err) {
    next(err);
  }
});

// Update patent (requires auth)
router.put("/:id", requireAuth, async (req, res, next) => {
  try {
    const existingPatent = await Patent.findById(req.params.id).lean();
    const wasAlreadyFiled = existingPatent?.patentType === "filed";

    const patent = await Patent.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    if (!patent) {
      return res.status(404).json({ error: { message: "Patent not found" } });
    }

    if (patent.patentType === "filed") {
      // If converted to filed just now, notify admins
      if (!wasAlreadyFiled) {
        notifyAdminsAboutFiledPatent(patent);
      }
      const expiration = calculateExpiration(patent.filingDate, patent.filingType, patent.provisionalExpiration);
      return res.json({
        item: {
          ...patent.toObject(),
          provisionalExpiration: expiration,
          isExpiringExpiringSoon: isExpiringExpiringSoon(expiration),
        },
      });
    }

    res.json({ item: patent });
  } catch (err) {
    next(err);
  }
});

// Delete patent (requires auth)
router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const patent = await Patent.findByIdAndDelete(req.params.id);
    if (!patent) {
      return res.status(404).json({ error: { message: "Patent not found" } });
    }
    res.json({ message: "Patent deleted successfully" });
  } catch (err) {
    next(err);
  }
});
// ── Notification Settings Endpoints ──

// Get current patent notification settings
router.get("/notification-settings", requireAuth, async (req, res, next) => {
  try {
    let settings = await SystemSettings.findOne({ key: "global" }).lean();
    const defaultDays = [1, 7, 15, 30, 60, 90, 120, 180];
    const notificationDays = settings?.patentExpirationConfig?.notificationDays || defaultDays;
    const smtpConfigured = Boolean(settings?.emailConfig?.host && settings?.emailConfig?.user && settings?.emailConfig?.pass);
    const templateEnabled = settings?.templates?.patentExpiration?.enabled !== false;

    res.json({
      item: {
        notificationDays: [...notificationDays].sort((a, b) => a - b),
        smtpConfigured,
        templateEnabled,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Update patent notification settings (admin/super-admin only)
router.put("/notification-settings", requireAuth, async (req, res, next) => {
  try {
    const role = req.user?.role;
    if (!["super-admin", "admin"].includes(role)) {
      return res.status(403).json({ error: { message: "Only admins and super-admins can update notification settings" } });
    }

    const { notificationDays } = req.body;
    if (!Array.isArray(notificationDays) || notificationDays.length === 0) {
      return res.status(400).json({ error: { message: "notificationDays must be a non-empty array of numbers" } });
    }

    // Validate all entries are positive integers
    const cleanDays = notificationDays
      .map((d) => Math.round(Number(d)))
      .filter((d) => Number.isFinite(d) && d > 0);

    if (cleanDays.length === 0) {
      return res.status(400).json({ error: { message: "At least one valid positive number is required" } });
    }

    // Deduplicate and sort ascending
    const uniqueDays = [...new Set(cleanDays)].sort((a, b) => a - b);

    await SystemSettings.findOneAndUpdate(
      { key: "global" },
      { $set: { "patentExpirationConfig.notificationDays": uniqueDays } },
      { upsert: true, new: true }
    );

    res.json({ message: "Notification settings updated", notificationDays: uniqueDays });
  } catch (err) {
    next(err);
  }
});

// Send a test patent expiration email to the requesting admin
router.post("/test-expiration-email", requireAuth, async (req, res, next) => {
  try {
    const role = req.user?.role;
    if (!["super-admin", "admin"].includes(role)) {
      return res.status(403).json({ error: { message: "Only admins and super-admins can send test emails" } });
    }

    const recipientEmail = req.user?.email || req.user?.username;
    if (!recipientEmail || !String(recipientEmail).includes("@")) {
      return res.status(400).json({ error: { message: "Your account does not have a valid email address configured" } });
    }

    const recipientName = req.user?.name || req.user?.username || "Admin";

    // Send using the patentExpiration template with test data
    const sent = await sendSystemEmail({
      to: recipientEmail,
      templateKey: "patentExpiration",
      variables: {
        name: recipientName,
        patentName: "TEST — Sample Patent Notification",
        daysUntilExpiration: "30",
        expirationDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
        applicationNumber: "TEST-123456",
        category: "Test Category",
      },
    });

    if (sent) {
      res.json({ message: `Test email sent successfully to ${recipientEmail}` });
    } else {
      res.status(500).json({
        error: {
          message: "Email could not be sent. Please check: 1) SMTP settings are configured in System Email Settings, 2) The 'Patent Expiration' email template is enabled.",
        },
      });
    }
  } catch (err) {
    next(err);
  }
});

// Reset notifiedDays on a patent so notifications re-trigger
router.post("/reset-notifications/:id", requireAuth, async (req, res, next) => {
  try {
    const role = req.user?.role;
    if (!["super-admin", "admin"].includes(role)) {
      return res.status(403).json({ error: { message: "Only admins and super-admins can reset notifications" } });
    }

    const patent = await Patent.findById(req.params.id);
    if (!patent) {
      return res.status(404).json({ error: { message: "Patent not found" } });
    }

    patent.notifiedDays = [];
    await patent.save();

    res.json({ message: `Notifications reset for patent '${patent.patentName}'. Next job run will re-send alerts.` });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

