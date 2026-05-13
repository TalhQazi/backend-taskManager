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

    // Emit real-time via socket.io — targeted to recipient rooms only
    const io = global.io;
    if (io) {
      const payload = {
        ...notification.toObject(),
        id: String(notification._id),
        title: titlePlain,
        content: content,
        message: content,
      };
      // targetSet contains role names ("admin", "manager", "super-admin") and specific usernames.
      // Each connected client joins their username room + role room via "register-user".
      Array.from(targetSet).forEach((room) => {
        io.to(room).emit("new-notification", payload);
      });
    }

    console.log(`[Notification] Created for [${recipient}]: ${content}`);
    return notification;
  } catch (err) {
    console.error("[Notification] Failed to create notification:", err);
    return null;
  }
}

/**
 * In-app milestone toast for an employee (uses Message broadcast, same as /api/messages).
 * @param {import("mongoose").Document | object} employee - Employee doc or lean object
 * @param {{ milestoneLevel: string, milestoneLabel: string }} milestone
 */
async function createMilestoneBroadcastForEmployee(employee, { milestoneLevel, milestoneLabel }) {
  try {
    const idStr = String(employee._id || "");
    const username = String(employee.username || "").trim();
    const email = String(employee.email || "").trim();
    const recipient = [...new Set([username, email, idStr].filter(Boolean))].join(",");
    if (!recipient) {
      console.warn("[Milestone] No recipient identifiers for employee", idStr);
      return null;
    }

    const timestamp = new Date().toISOString();
    const titlePlain = "🎉 Milestone Achievement!";
    const contentPlain = `Congratulations! You've reached ${milestoneLabel || milestoneLevel}!`;

    const notification = await Message.create({
      title: encrypt(titlePlain),
      sender: "system",
      senderAvatar: "",
      recipient,
      audience: recipient,
      assignees: [],
      content: encrypt(contentPlain),
      timestamp,
      type: "broadcast",
      status: "sent",
      readBy: [],
      meta: {
        resourceType: "milestone",
        resourceId: idStr,
        link: "/employee/profile",
        category: "MILESTONE",
      },
    });

    const io = global.io;
    if (io) {
      const payload = {
        ...notification.toObject(),
        id: String(notification._id),
        title: titlePlain,
        content: contentPlain,
        message: contentPlain,
      };
      recipient.split(",").forEach((room) => {
        if (room) io.to(room).emit("new-notification", payload);
      });
    }

    return notification;
  } catch (err) {
    console.error("[Milestone] Failed to create milestone broadcast:", err);
    return null;
  }
}

module.exports = { createNotification, createMilestoneBroadcastForEmployee };
