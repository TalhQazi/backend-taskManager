const Patent = require("../models/Patent");
const User = require("../models/User");
const Employee = require("../models/Employee");
const SystemSettings = require("../models/SystemSettings");
const { createNotification } = require("../utils/notifications");
const { sendSystemEmail } = require("../lib/email");

const DEFAULT_THRESHOLDS = [1, 7, 15, 30, 60, 90, 120, 180];

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

/**
 * Load custom notification day thresholds from SystemSettings.
 * Falls back to DEFAULT_THRESHOLDS if nothing is configured.
 */
async function loadNotificationThresholds() {
  try {
    const settings = await SystemSettings.findOne({ key: "global" }).lean();
    const custom = settings?.patentExpirationConfig?.notificationDays;
    if (Array.isArray(custom) && custom.length > 0) {
      // Sort ascending so the smallest threshold is checked first
      return [...custom].sort((a, b) => a - b);
    }
  } catch (err) {
    console.error("[Expiry Job] Failed to load custom thresholds, using defaults:", err.message);
  }
  return [...DEFAULT_THRESHOLDS];
}

async function checkPatentExpirations(forceSend = false) {
  console.log("[Expiry Job] Running patent expiration check...");
  const results = { checked: 0, expiring: 0, notified: 0, errors: [] };
  try {
    // Load custom thresholds from DB
    const thresholds = await loadNotificationThresholds();
    console.log("[Expiry Job] Using notification thresholds:", thresholds.join(", "));

    const patents = await Patent.find({ patentType: "filed" });
    const today = new Date();
    results.checked = patents.length;
    console.log(`[Expiry Job] Found ${patents.length} filed patent(s) to check.`);

    for (const patent of patents) {
      const expiration = calculateExpiration(patent.filingDate, patent.filingType, patent.provisionalExpiration);
      if (!expiration) {
        console.log(`[Expiry Job] Skipping '${patent.patentName}' — no expiration date computable.`);
        continue;
      }

      const timeDiff = expiration.getTime() - today.getTime();
      const daysUntilExpiration = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));

      // Auto-expire patents that have passed their expiration date
      if (daysUntilExpiration <= 0 && patent.status !== "Expired") {
        patent.status = "Expired";
        await patent.save();
        console.log(`[Expiry Job] Patent '${patent.patentName}' marked as Expired.`);
      }

      // Use per-patent custom reminder days if set, otherwise fall back to global thresholds
      const patentThresholds = (Array.isArray(patent.customReminderDays) && patent.customReminderDays.length > 0)
        ? [...patent.customReminderDays].sort((a, b) => a - b)
        : thresholds;

      // Check if any threshold triggers
      let triggeredThreshold = null;

      for (const t of patentThresholds) {
        if (daysUntilExpiration <= t && (forceSend || !patent.notifiedDays.includes(t))) {
          triggeredThreshold = t;
          break;
        }
      }

      if (triggeredThreshold !== null) {
        results.expiring++;
        console.log(`[Expiry Job] Triggered threshold ${triggeredThreshold}d for patent: ${patent.patentName} (${daysUntilExpiration} days remaining)`);

        // Add this threshold and all larger ones to notifiedDays
        patentThresholds.forEach((t) => {
          if (t >= triggeredThreshold && !patent.notifiedDays.includes(t)) {
            patent.notifiedDays.push(t);
          }
        });

        await patent.save();

        // Send Push Notification
        const expirationDateFormatted = expiration.toISOString().split("T")[0];
        const detailMessage = `Patent '${patent.patentName}' is expiring in ${daysUntilExpiration} day(s) (Expiration Date: ${expirationDateFormatted}).`;

        try {
          await createNotification({
            actor: "System",
            actorRole: "system",
            action: "expiring soon",
            resourceType: "patent",
            resourceName: patent.patentName,
            category: "TASK_ASSIGNED",
            details: detailMessage,
            resourceId: String(patent._id),
            link: "/admin/intellectual-property"
          });
          console.log(`[Expiry Job] Push notification created for '${patent.patentName}'.`);
        } catch (notifErr) {
          console.error("[Expiry Job] Notification creation error:", notifErr.message);
          results.errors.push(`Notification: ${notifErr.message}`);
        }

        // Query active super-admins, admins, and managers from both User and Employee collections
        const userAdmins = await User.find({
          role: { $in: ["super-admin", "admin", "manager"] },
          status: "active",
          email: { $exists: true, $ne: "" },
        }).select("email name username").lean();

        const empAdmins = await Employee.find({
          userRole: { $in: ["super-admin", "admin", "manager"] },
          userStatus: "active",
          email: { $exists: true, $ne: "" },
        }).select("email name").lean();

        const recipientMap = new Map();
        userAdmins.forEach((u) => {
          if (u.email) recipientMap.set(u.email.toLowerCase(), u.name || u.username || "Admin");
        });
        empAdmins.forEach((e) => {
          if (e.email) recipientMap.set(e.email.toLowerCase(), e.name || "Admin");
        });

        console.log(`[Expiry Job] Found ${recipientMap.size} recipient(s) for email alerts.`);

        if (recipientMap.size === 0) {
          console.warn("[Expiry Job] WARNING: No admin/super-admin/manager recipients found. No emails will be sent.");
          results.errors.push("No admin recipients found");
        }

        for (const [email, name] of recipientMap.entries()) {
          try {
            console.log(`[Expiry Job] Sending email to ${email} for patent '${patent.patentName}'...`);
            const sent = await sendSystemEmail({
              to: email,
              templateKey: "patentExpiration",
              variables: {
                name,
                patentName: patent.patentName || "N/A",
                daysUntilExpiration: String(Math.max(0, daysUntilExpiration)),
                expirationDate: expirationDateFormatted,
                applicationNumber: patent.applicationNumber || "N/A",
                category: patent.category || "N/A"
              }
            });
            if (sent) {
              results.notified++;
              console.log(`[Expiry Job] ✓ Email sent successfully to ${email}`);
            } else {
              console.warn(`[Expiry Job] ✗ sendSystemEmail returned false for ${email} — check template enabled status or SMTP config.`);
              results.errors.push(`Email to ${email} returned false`);
            }
          } catch (emailErr) {
            console.error(`[Expiry Job] ✗ Failed to send email to ${email}:`, emailErr.message);
            results.errors.push(`Email to ${email}: ${emailErr.message}`);
          }
        }
      }
    }
    console.log(`[Expiry Job] Completed. Checked: ${results.checked}, Expiring: ${results.expiring}, Emails Sent: ${results.notified}, Errors: ${results.errors.length}`);
    return results;
  } catch (error) {
    console.error("[Expiry Job] Error checking patent expirations:", error);
    results.errors.push(error.message);
    return results;
  }
}

module.exports = { checkPatentExpirations, calculateExpiration };
