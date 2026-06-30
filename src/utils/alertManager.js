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

    const recipients = await NotificationRecipient.find({ isActive: true });
    let recipientsList = recipients.map(r => ({ name: r.name, email: r.email }));

    if (recipientsList.length === 0) {
      console.log("[AlertManager] No specific recipients configured. Falling back to active super-admins, admins, and managers.");
      const User = require("../models/User");
      const adminsAndManagers = await User.find({
        role: { $in: ["super-admin", "admin", "manager"] },
        status: "active",
        email: { $exists: true, $ne: "" }
      });
      recipientsList = adminsAndManagers.map(u => ({ name: u.name || u.username, email: u.email }));
    }

    if (recipientsList.length === 0) {
      console.warn("No recipients found for health alerts (NotificationRecipient and active admins/managers are empty).");
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
