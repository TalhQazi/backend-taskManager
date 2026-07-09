const { sendSystemEmail } = require("../lib/email");
const Settings = require("../models/Settings");
const User = require("../models/User");

/**
 * Sends an email notification if the user has email notifications enabled.
 * @param {string} usernameOrId - The username or ID of the user to send the email to.
 * @param {string} templateKey - Key of the template to use (e.g., 'taskAssignment').
 * @param {Object} variables - Variables to replace in the template.
 */
async function sendEmailNotification(usernameOrId, templateKey, variables = {}) {
  try {
    // Find the user — try username first, then display name, then ObjectId
    let user = await User.findOne({ username: usernameOrId });
    if (!user) {
      user = await User.findOne({ email: usernameOrId });
    }
    if (!user) {
      user = await User.findOne({ name: usernameOrId });
    }
    if (!user) {
      try { user = await User.findById(usernameOrId); } catch (_) { /* not an ObjectId */ }
    }
    if (!user || !user.email) {
      console.warn(`Could not find email for user: ${usernameOrId}`);
      return false;
    }

    // Check user settings
    const settings = await Settings.findOne({ userId: String(user._id) });
    const emailNotificationsEnabled = settings ? (settings.notifications && settings.notifications.emailNotifications !== false) : true;
    
    if (!emailNotificationsEnabled) {
      console.log(`User ${user.username} has email notifications disabled globally.`);
      return false;
    }

    if (settings && settings.emailPreferences) {
      let keyToCheck = templateKey;
      if (templateKey === "fileAttachment") keyToCheck = "commentAdded";
      if (templateKey === "projectReassignment") keyToCheck = "projectAssignment";
      
      const isEnabled = settings.emailPreferences[keyToCheck];
      if (isEnabled === false) {
        console.log(`User ${user.username} has email notification for ${templateKey} disabled.`);
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
