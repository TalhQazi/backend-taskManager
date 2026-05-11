const Message = require("../models/Message");

// Add notification types for missing documents, payroll updates, and W-2 availability
const NOTIFICATION_TYPES = {
  MISSING_DOCUMENT: "Missing Document Alert",
  PAYROLL_POSTED: "Payroll Posted Alert",
  W2_AVAILABLE: "End-of-Year W-2 Alert",
};

/**
 * Create a notification with targeted audience.
 *
 * Audience rules:
 *  - "super-admin" role always receives every notification.
 *  - For task/project create: also delivered to the actor (creator) and all assignees.
 *  - No-one else sees it.
 *
 * @param {Object}   options
 * @param {string}   options.actor        - username of the person who acted
 * @param {string}   options.actorRole    - role of the actor
 * @param {string}   options.action       - "created" | "updated" | "deleted" …
 * @param {string}   options.resourceType - "task" | "project" | …
 * @param {string}   options.resourceName
 * @param {string[]} [options.assignees]  - usernames being assigned
 * @param {string}   [options.details]
 * @param {string}   [options.resourceId]
 * @param {string}   [options.link]
 */
async function createNotification({
  actor,
  actorRole,
  action,
  resourceType,
  resourceName,
  assignees = [],
  details = "",
  resourceId = "",
  link = "",
}) {
  try {
    const timestamp = new Date().toISOString();

    // Build content string
    let content = `${actor} ${action} ${resourceType}`;
    if (resourceName) content += ` "${resourceName}"`;
    if (assignees.length > 0) content += ` — assigned to: ${assignees.join(", ")}`;
    if (details) content += ` (${details})`;

    // Targeted recipients: all roles + actor + assignees (deduped)
    const targetSet = new Set(["super-admin", "admin", "manager"]);
    if (actor) targetSet.add(String(actor).trim());
    (Array.isArray(assignees) ? assignees : []).forEach((a) => {
      if (a) targetSet.add(String(a).trim());
    });
    const recipient = Array.from(targetSet).join(",");

    const notification = await Message.create({
      title: `${action.charAt(0).toUpperCase() + action.slice(1)} ${resourceType}`,
      sender: actor || "system",
      senderAvatar: "",
      recipient,           // comma-separated list of usernames/roles who should see it
      audience: "targeted",
      assignees: Array.isArray(assignees) ? assignees : [],
      content,
      timestamp,
      type: "broadcast",
      status: "sent",
      readBy: [],
      meta: {
        resourceType: String(resourceType || ""),
        resourceId: String(resourceId || ""),
        link: String(link || ""),
      },
    });

    // Emit real-time via socket.io
    const io = global.io;
    if (io) {
      io.emit("new-notification", {
        ...notification.toObject(),
        id: String(notification._id),
      });
    }

    console.log(`[Notification] Created for [${recipient}]: ${content}`);
    return notification;
  } catch (err) {
    console.error("[Notification] Failed to create notification:", err);
    return null;
  }
}

async function notifyMissingDocument(employeeId, documentName) {
  await createNotification({
    actor: "System",
    actorRole: "admin",
    action: "alerted",
    resourceType: "document",
    resourceName: documentName,
    assignees: [employeeId],
    details: NOTIFICATION_TYPES.MISSING_DOCUMENT,
  });
}

async function notifyPayrollPosted(employeeId) {
  await createNotification({
    actor: "System",
    actorRole: "admin",
    action: "alerted",
    resourceType: "payroll",
    resourceName: "Payroll Update",
    assignees: [employeeId],
    details: NOTIFICATION_TYPES.PAYROLL_POSTED,
  });
}

async function notifyW2Available(employeeId) {
  await createNotification({
    actor: "System",
    actorRole: "admin",
    action: "alerted",
    resourceType: "tax document",
    resourceName: "W-2 Form",
    assignees: [employeeId],
    details: NOTIFICATION_TYPES.W2_AVAILABLE,
  });
}

module.exports = { createNotification, notifyMissingDocument, notifyPayrollPosted, notifyW2Available };
