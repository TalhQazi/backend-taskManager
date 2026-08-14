const Patent = require("../models/Patent");
const User = require("../models/User");
const Employee = require("../models/Employee");
const { createNotification } = require("../utils/notifications");
const { sendEmailNotification } = require("../utils/emailNotifications");

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

async function checkPatentExpirations() {
  console.log("[Expiry Job] Running patent expiration check...");
  try {
    const patents = await Patent.find({ patentType: "filed" });
    const today = new Date();

    for (const patent of patents) {
      const expiration = calculateExpiration(patent.filingDate, patent.filingType, patent.provisionalExpiration);
      if (!expiration) continue;

      const timeDiff = expiration.getTime() - today.getTime();
      const daysUntilExpiration = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));

      // Auto-expire patents that have passed their expiration date
      if (daysUntilExpiration <= 0 && patent.status !== "Expired") {
        patent.status = "Expired";
        await patent.save();
        console.log(`[Expiry Job] Patent '${patent.patentName}' marked as Expired.`);
      }

      // Send email & push alerts at 180, 120, 90, 60, 30, 15, 7, 1 days before expiry
      const thresholds = [1, 7, 15, 30, 60, 90, 120, 180];
      let triggeredThreshold = null;

      for (const t of thresholds) {
        if (daysUntilExpiration <= t && !patent.notifiedDays.includes(t)) {
          triggeredThreshold = t;
          break;
        }
      }

      if (triggeredThreshold !== null) {
        console.log(`[Expiry Job] Triggered threshold ${triggeredThreshold} for patent: ${patent.patentName} (${daysUntilExpiration} days remaining)`);

        // Add this threshold and all larger ones to notifiedDays
        thresholds.forEach((t) => {
          if (t >= triggeredThreshold && !patent.notifiedDays.includes(t)) {
            patent.notifiedDays.push(t);
          }
        });

        await patent.save();

        // Send Push Notification
        const detailMessage = `Patent '${patent.patentName}' is expiring in ${daysUntilExpiration} day(s) (Expiration Date: ${expiration.toLocaleDateString()}).`;

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

        // Query active super-admins, admins, and managers from both User and Employee collections
        const userAdmins = await User.find({
          role: { $in: ["super-admin", "admin", "manager"] },
          status: "active"
        }).select("_id email username name").lean();

        const empAdmins = await Employee.find({
          userRole: { $in: ["super-admin", "admin", "manager"] },
          userStatus: "active"
        }).select("_id email name").lean();

        const targets = new Set();
        userAdmins.forEach((u) => targets.add(String(u._id || u.username || u.email)));
        empAdmins.forEach((e) => targets.add(String(e._id || e.email)));

        for (const targetId of targets) {
          await sendEmailNotification(targetId, "patentExpiration", {
            patentName: patent.patentName,
            daysUntilExpiration: String(Math.max(0, daysUntilExpiration)),
            expirationDate: expiration.toISOString().split("T")[0],
            applicationNumber: patent.applicationNumber || "N/A",
            category: patent.category || "N/A"
          });
        }
      }
    }
  } catch (error) {
    console.error("[Expiry Job] Error checking patent expirations:", error);
  }
}

module.exports = { checkPatentExpirations };
