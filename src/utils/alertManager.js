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

    // 2. Add active Users and Employees with websiteDownAlert enabled
    const User = require("../models/User");
    const Settings = require("../models/Settings");
    const Employee = require("../models/Employee");

    const activeUsers = await User.find({
      role: { $in: ["super-admin", "admin", "manager", "employee"] },
      status: "active",
      email: { $exists: true, $ne: "" }
    }).lean();

    const activeEmployees = await Employee.find({
      userRole: { $in: ["super-admin", "admin", "manager", "employee"] },
      userStatus: "active",
      email: { $exists: true, $ne: "" }
    }).lean();

    // Map Employees to a user-like shape
    const employeeUsers = activeEmployees.map(emp => ({
      _id: emp._id,
      email: emp.email,
      name: emp.name,
      username: emp.email,
      role: emp.userRole,
      status: emp.userStatus,
      isEmployee: true
    }));

    // Combine both arrays, prioritizing Employee records if email matches
    const allUsersMap = new Map();
    activeUsers.forEach(u => {
      if (u.email) {
        allUsersMap.set(u.email.toLowerCase(), { ...u, isEmployee: false });
      }
    });
    employeeUsers.forEach(e => {
      if (e.email) {
        allUsersMap.set(e.email.toLowerCase(), e);
      }
    });

    const combinedUsers = Array.from(allUsersMap.values());

    function escapeRegex(string) {
      return string ? String(string).replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&') : '';
    }

    for (const u of combinedUsers) {
      // Avoid duplicate emails if they are also in NotificationRecipient
      if (recipientsList.some(r => r.email.toLowerCase() === u.email.toLowerCase())) {
        continue;
      }

      let employeeId = String(u._id);
      if (!u.isEmployee) {
        const emp = await Employee.findOne({
          $or: [
            { email: new RegExp(`^${escapeRegex(u.email)}$`, "i") },
            { name: new RegExp(`^${escapeRegex(u.name || u.username)}$`, "i") }
          ]
        }).lean();
        if (emp) {
          employeeId = String(emp._id);
        }
      }

      const settings = await Settings.findOne({
        $or: [
          { userId: employeeId },
          { userId: String(u._id) }
        ]
      }).lean();
      
      // Default websiteDownAlert:
      // - false for all users/roles. Only enabled if explicitly turned on in settings.
      let isEnabled = false;
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
