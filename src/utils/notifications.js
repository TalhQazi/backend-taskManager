const Message = require("../models/Message");
const User = require("../models/User");

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

    // Targeted recipients: super-admin role + actor + assignees (deduped)
    // IMPORTANT: `assignees` may contain usernames OR display names OR userIds.
    // We try to resolve users and include both `username` and `sub/_id` style IDs
    // so the GET /api/notifications?type=broadcast filtering (role/username/userId)
    // matches reliably across panels.
    const targetSet = new Set(["super-admin"]);
    if (actor) targetSet.add(String(actor).trim());

    const rawAssignees = (Array.isArray(assignees) ? assignees : [])
      .map((a) => String(a || "").trim())
      .filter(Boolean);

    rawAssignees.forEach((a) => targetSet.add(a));

    if (rawAssignees.length > 0) {
      const resolvedUsers = await User.find({
        $or: [
          { username: { $in: rawAssignees } },
          { name: { $in: rawAssignees } },
          { _id: { $in: rawAssignees.filter((x) => /^[a-f\d]{24}$/i.test(x)) } },
        ],
      })
        .select("_id username")
        .lean();

      (resolvedUsers || []).forEach((u) => {
        if (u?.username) targetSet.add(String(u.username).trim());
        if (u?._id) targetSet.add(String(u._id));
      });
    }

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

module.exports = { createNotification };
