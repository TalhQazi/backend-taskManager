const Message = require("../models/Message");

/**
 * Create a notification message that will be broadcast to all admin and manager users
 * @param {Object} options
 * @param {string} options.actor - The user who performed the action (e.g., "Admin", "Manager", "John Doe")
 * @param {string} options.actorRole - The role of the actor (e.g., "admin", "manager", "super-admin")
 * @param {string} options.action - The action performed (e.g., "created", "updated", "deleted", "status changed")
 * @param {string} options.resourceType - The type of resource (e.g., "employee", "task", "company")
 * @param {string} options.resourceName - The name of the resource affected
 * @param {string} [options.details] - Additional details about the action
 */
async function createNotification({ actor, actorRole, action, resourceType, resourceName, details = "" }) {
  try {
    const timestamp = new Date().toISOString();
    
    // Format the notification content
    let content = `${actor} ${action} ${resourceType}`;
    if (resourceName) {
      content += ` "${resourceName}"`;
    }
    if (details) {
      content += ` - ${details}`;
    }

    // Create broadcast message for all users
    const notification = await Message.create({
      title: `${action.charAt(0).toUpperCase() + action.slice(1)} ${resourceType}`,
      sender: actor,
      senderAvatar: "",
      recipient: "all", // Broadcast to all
      audience: "all",
      content: content,
      timestamp: timestamp,
      type: "broadcast",
      status: "sent",
    });

    console.log(`[Notification] Created: ${content}`);
    return notification;
  } catch (err) {
    console.error("[Notification] Failed to create notification:", err);
    // Don't throw - notifications should not break main functionality
    return null;
  }
}

module.exports = { createNotification };
