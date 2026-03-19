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
 * @param {string} [options.resourceId] - The ID of the resource affected
 * @param {string} [options.link] - Optional UI link (if you want to force a specific frontend path)
 */
async function createNotification({
  actor,
  actorRole,
  action,
  resourceType,
  resourceName,
  details = "",
  resourceId = "",
  link = "",
  recipient = "all",
  audience = "all",
}) {
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
      recipient: String(recipient || "all"),
      audience: String(audience || "all"),
      content: content,
      timestamp: timestamp,
      type: "broadcast",
      status: "sent",
      meta: {
        resourceType: String(resourceType || ""),
        resourceId: String(resourceId || ""),
        link: String(link || ""),
      },
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
