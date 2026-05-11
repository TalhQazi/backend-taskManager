const Message = require("../models/Message");
const { encrypt } = require("../lib/encryption");

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
 * @param {string}   [options.category]   - "TASK_ASSIGNED" | "PROJECT_ASSIGNED" | "MENTIONED" | "COMMENT_ADDED" | "TASK_COMPLETED"
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
  category = "",
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

    let derivedLink = link;
    if (!derivedLink && resourceId) {
      if (resourceType === "task" || resourceType === "task comment") {
        derivedLink = `/admin/tasks/${resourceId}`;
      } else if (resourceType === "project" || resourceType === "project comment") {
        derivedLink = `/admin/projects/${resourceId}`;
      }
    }

    let derivedCategory = category;
    if (!derivedCategory) {
       if (action.includes("mention")) derivedCategory = "MENTIONED";
       else if (action.includes("comment")) derivedCategory = "COMMENT_ADDED";
       else if (resourceType === "task" && action.includes("assign")) derivedCategory = "TASK_ASSIGNED";
       else if (resourceType === "project" && action.includes("assign")) derivedCategory = "PROJECT_ASSIGNED";
       else derivedCategory = "SYSTEM";
    }

    const titlePlain = `${action.charAt(0).toUpperCase() + action.slice(1)} ${resourceType}`;

    const notification = await Message.create({
      title: encrypt(titlePlain),
      sender: actor || "system",
      senderAvatar: "",
      recipient,           // comma-separated list of usernames/roles who should see it
      audience: "targeted",
      assignees: Array.isArray(assignees) ? assignees : [],
      content: encrypt(content),
      timestamp,
      type: "broadcast",
      status: "sent",
      readBy: [],
      meta: {
        resourceType: String(resourceType || ""),
        resourceId: String(resourceId || ""),
        link: String(derivedLink || ""),
        category: String(derivedCategory),
      },
    });

    // Emit real-time via socket.io
    const io = global.io;
    if (io) {
      io.emit("new-notification", {
        ...notification.toObject(),
        id: String(notification._id),
        title: titlePlain,
        content: content,
        message: content // For backward compatibility with frontend expecting 'message'
      });
    }

    console.log(`[Notification] Created for [${recipient}]: ${content}`);
    return notification;
  } catch (err) {
    console.error("[Notification] Failed to create notification:", err);
    return null;
  }
}

module.exports = { createNotification };
