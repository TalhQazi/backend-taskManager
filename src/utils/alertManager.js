const { sendRawEmail } = require("../lib/email");
const NotificationRecipient = require("../models/NotificationRecipient");
const NotificationLog = require("../models/NotificationLog");
const AlertRule = require("../models/AlertRule");

/**
 * Dispatch an email alert to all active recipients
 * @param {string} subject 
 * @param {string} body 
 * @param {string} condition - e.g. "DOWN", "DEGRADED", "SSL_EXPIRING", "RECOVERED"
 */
async function dispatchAlert(subject, body, condition) {
  try {
    // If it's not a RECOVERED alert, check if the rule is enabled
    if (condition !== "RECOVERED") {
      const rule = await AlertRule.findOne({ condition, isEnabled: true });
      if (!rule) {
        console.log(`Alert ignored: No active rule for condition ${condition}`);
        return;
      }
    }

    const recipientsList = [];

    // 1. Add active NotificationRecipients
    const customRecipients = await NotificationRecipient.find({ isActive: true });
    customRecipients.forEach(r => {
      recipientsList.push({ name: r.name, email: r.email });
    });

    // 2. Add active Users with websiteDownAlert enabled
    const User = require("../models/User");
    const Settings = require("../models/Settings");

    const activeUsers = await User.find({
      role: { $in: ["super-admin", "admin", "manager", "employee"] },
      status: "active",
      email: { $exists: true, $ne: "" }
    }).lean();

    for (const u of activeUsers) {
      // Avoid duplicate emails if they are also in NotificationRecipient
      if (recipientsList.some(r => r.email.toLowerCase() === u.email.toLowerCase())) {
        continue;
      }

      const settings = await Settings.findOne({ userId: String(u._id) }).lean();
      
      // Default websiteDownAlert:
      // - true for super-admin, admin, manager
      // - false for employee (to prevent spam, but they can toggle it on!)
      let isEnabled = u.role === "super-admin" || u.role === "admin" || u.role === "manager";
      if (settings && settings.emailPreferences && typeof settings.emailPreferences.websiteDownAlert === "boolean") {
        isEnabled = settings.emailPreferences.websiteDownAlert;
      }

      if (isEnabled) {
        recipientsList.push({ name: u.name || u.username, email: u.email });
      }
    }

    if (recipientsList.length === 0) {
      console.warn("No recipients found for health alerts.");
      return;
    }

    for (const recipient of recipientsList) {
      const success = await sendRawEmail({
        to: recipient.email,
        subject,
        body
      });

      await NotificationLog.create({
        recipientEmail: recipient.email,
        subject,
        body,
        status: success ? "SENT" : "FAILED"
      });
    }
  } catch (err) {
    console.error("Error dispatching alert:", err);
  }
}

module.exports = { dispatchAlert };
