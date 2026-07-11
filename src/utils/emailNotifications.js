const { sendSystemEmail } = require("../lib/email");
const Settings = require("../models/Settings");
const User = require("../models/User");
const Employee = require("../models/Employee");

function escapeRegex(string) {
  return string ? String(string).replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&') : '';
}

/**
 * Sends an email notification if the user has email notifications enabled.
 * @param {string} usernameOrId - The username or ID of the user to send the email to.
 * @param {string} templateKey - Key of the template to use (e.g., 'taskAssignment').
 * @param {Object} variables - Variables to replace in the template.
 */
async function sendEmailNotification(usernameOrId, templateKey, variables = {}) {
  try {
    let employee = null;

    // 1. Try to find directly in Employee collection by email (case-insensitive)
    if (usernameOrId && String(usernameOrId).includes("@")) {
      employee = await Employee.findOne({ email: new RegExp(`^${escapeRegex(usernameOrId)}$`, "i") });
    }

    // 2. Try to find by name (case-insensitive)
    if (!employee) {
      employee = await Employee.findOne({ name: new RegExp(`^${escapeRegex(usernameOrId)}$`, "i") });
    }

    // 3. Try to find by Employee ObjectId
    if (!employee) {
      try {
        employee = await Employee.findById(usernameOrId);
      } catch (_) {
        /* not an ObjectId */
      }
    }

    // 4. Fallback: Search User collection, and if found, find matching Employee by email or name
    if (!employee) {
      let user = await User.findOne({ username: usernameOrId });
      if (!user) {
        user = await User.findOne({ email: usernameOrId });
      }
      if (!user) {
        user = await User.findOne({ name: usernameOrId });
      }
      if (!user) {
        try {
          user = await User.findById(usernameOrId);
        } catch (_) {
          /* not an ObjectId */
        }
      }

      if (user) {
        employee = await Employee.findOne({
          $or: [
            { email: new RegExp(`^${escapeRegex(user.email)}$`, "i") },
            { name: new RegExp(`^${escapeRegex(user.name || user.username)}$`, "i") }
          ]
        });
      }
    }

    if (!employee || !employee.email) {
      console.warn(`Could not find email/employee for user: ${usernameOrId}`);
      return false;
    }

    // Check user settings under Employee ID (where settings are saved)
    const settings = await Settings.findOne({ userId: String(employee._id) });
    const emailNotificationsEnabled = settings ? (settings.notifications && settings.notifications.emailNotifications !== false) : true;
    
    if (!emailNotificationsEnabled) {
      console.log(`User ${employee.email} has email notifications disabled globally.`);
      return false;
    }

    if (settings && settings.emailPreferences) {
      let keyToCheck = templateKey;
      if (templateKey === "fileAttachment") keyToCheck = "commentAdded";
      if (templateKey === "projectReassignment") keyToCheck = "projectAssignment";
      if (templateKey === "newMessage") keyToCheck = "messageAlert";
      
      const isEnabled = settings.emailPreferences[keyToCheck];
      if (isEnabled === false) {
        console.log(`User ${employee.email} has email notification for ${templateKey} disabled.`);
        return false;
      }
    }

    variables.name = user.name || user.username;

    return await sendSystemEmail({
      to: user.email,
      templateKey,
      variables,
    });
  } catch (error) {
    console.error("Error sending email notification:", error);
    return false;
  }
}

module.exports = { sendEmailNotification };
