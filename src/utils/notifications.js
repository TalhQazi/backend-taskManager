const Message = require("../models/Message");
const TeamLeadMapping = require("../models/TeamLeadMapping");
const User = require("../models/User");

async function resolveManagersFromAssignees(assignees, teamLead = "") {
  if ((!Array.isArray(assignees) || assignees.length === 0) && !teamLead) return [];

  const names = (Array.isArray(assignees) ? assignees : [])
    .map((a) => String(a).trim())
    .filter(Boolean);
  if (teamLead) names.push(String(teamLead).trim());
  if (names.length === 0) return [];

  const managers = new Set();

  // Step 1: Find managers/admins directly assigned (match by name OR username)
  const directManagers = await User.find({
    $or: [{ name: { $in: names } }, { username: { $in: names } }],
    role: { $in: ["manager", "admin", "super-admin"] },
  }).lean();
  directManagers.forEach((u) => managers.add(u.username));

  // Step 2: For remaining names, resolve via TeamLeadMapping
  const matched = new Set(
    directManagers.map((u) => u.name).concat(directManagers.map((u) => u.username))
  );
  const remaining = names.filter((n) => !matched.has(n));

  if (remaining.length > 0) {
    // Gather all possible identifiers for remaining assignees
    const identifierSet = new Set(remaining);

    // Find corresponding Users for remaining names to get usernames/emails
    const correspondingUsers = await User.find({
      $or: [{ name: { $in: remaining } }, { username: { $in: remaining } }],
    }).lean();
    correspondingUsers.forEach((u) => {
      identifierSet.add(u.name);
      identifierSet.add(u.username);
      if (u.email) identifierSet.add(u.email);
    });

    // Find Employees for remaining names to get emails
    const Employee = require("../models/Employee");
    const employees = await Employee.find({ name: { $in: remaining } }).lean();
    employees.forEach((emp) => {
      identifierSet.add(emp.name);
      if (emp.email) identifierSet.add(emp.email);
    });

    const identifiers = Array.from(identifierSet).filter(Boolean);
    if (identifiers.length > 0) {
      const mappings = await TeamLeadMapping.find({
        user: { $in: identifiers },
      }).lean();

      // Resolve teamLead values back to usernames
      const teamLeadValues = [...new Set(mappings.map((m) => m.teamLead).filter(Boolean))];
      if (teamLeadValues.length > 0) {
        const teamLeadUsers = await User.find({
          $or: [
            { username: { $in: teamLeadValues } },
            { name: { $in: teamLeadValues } },
            { email: { $in: teamLeadValues } },
          ],
          role: { $in: ["manager", "admin", "super-admin"] },
        }).lean();
        teamLeadUsers.forEach((u) => managers.add(u.username));
      }
    }
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
 * @param {string[]} [options.assignees]  - names/usernames being assigned (employees or managers)
 * @param {string}   [options.teamLead]   - team lead name/username for the resource
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
  teamLead = "",
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
      Array.isArray(assignees) ? assignees : [],
      teamLead
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
