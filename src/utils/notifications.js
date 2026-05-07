const Message = require("../models/Message");
const TeamLeadMapping = require("../models/TeamLeadMapping");
const User = require("../models/User");

async function resolveManagersFromAssignees(assignees) {
  if (!Array.isArray(assignees) || assignees.length === 0) return [];

  const names = assignees.map((a) => String(a).trim()).filter(Boolean);
  if (names.length === 0) return [];

  const managers = new Set();

  // Find which assignees are already managers / admins
  const users = await User.find({
    username: { $in: names },
    role: { $in: ["manager", "admin", "super-admin"] },
  }).lean();
  users.forEach((u) => managers.add(u.username));

  // For remaining employees, resolve via TeamLeadMapping
  const managerNames = users.map((u) => u.username);
  const employeeNames = names.filter((n) => !managerNames.includes(n));

  if (employeeNames.length > 0) {
    const mappings = await TeamLeadMapping.find({
      user: { $in: employeeNames },
    }).lean();
    mappings.forEach((m) => {
      if (m.teamLead) managers.add(m.teamLead);
    });
  }

  return Array.from(managers);
}

/**
 * Create a notification with targeted audience.
 *
 * Audience rules:
 *  - "super-admin" role always receives every notification.
 *  - For task/project create: also delivered to the actor (creator) and the
 *    manager(s) who own the assignees (resolved via TeamLeadMapping).
 *  - No-one else sees it.
 *
 * @param {Object}   options
 * @param {string}   options.actor        - username of the person who acted
 * @param {string}   options.actorRole    - role of the actor
 * @param {string}   options.action       - "created" | "updated" | "deleted" …
 * @param {string}   options.resourceType - "task" | "project" | …
 * @param {string}   options.resourceName
 * @param {string[]} [options.assignees]  - usernames being assigned (employees or managers)
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

    // Resolve assignees to their managing team leads
    const managerRecipients = await resolveManagersFromAssignees(
      Array.isArray(assignees) ? assignees : []
    );

    // Targeted recipients: super-admin + actor + resolved managers
    const targetSet = new Set(["super-admin"]);
    if (actor) targetSet.add(String(actor).trim());
    managerRecipients.forEach((m) => targetSet.add(m));

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
