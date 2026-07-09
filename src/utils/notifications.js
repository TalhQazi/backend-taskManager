const Message = require("../models/Message");
const { encrypt } = require("../lib/encryption");

/**
 * Create a targeted notification.
 *
 * Recipient rules by category:
 *  TASK_ASSIGNED / PROJECT_ASSIGNED / TASK_COMPLETED
 *    → admin + manager role rooms + actor + assignees
 *  MENTIONED
 *    → ONLY the mentioned users (assignees) + actor. NOT all admins/managers.
 *  COMMENT_ADDED
 *    → ONLY the specific assignees passed (task assignees + creator) + actor.
 *      NOT all admins/managers (admin is already included if they created the task).
 *  SYSTEM
 *    → Skipped entirely. These belong in the activity log, not notifications.
 *
 * @param {Object}   options
 * @param {string}   options.actor
 * @param {string}   options.actorRole
 * @param {string}   options.action
 * @param {string}   options.resourceType
 * @param {string}   options.resourceName
 * @param {string[]} [options.assignees]
 * @param {string}   [options.details]
 * @param {string}   [options.resourceId]
 * @param {string}   [options.link]
 * @param {string}   [options.category]
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
    // Derive category when not provided
    let derivedCategory = category;
    if (!derivedCategory) {
      if (action.includes("mention")) derivedCategory = "MENTIONED";
      else if (action.includes("comment")) derivedCategory = "COMMENT_ADDED";
      else if ((resourceType === "task" || resourceType === "project") &&
               (action.includes("assign") || action.includes("creat") || action.includes("reassign")))
        derivedCategory = resourceType === "task" ? "TASK_ASSIGNED" : "PROJECT_ASSIGNED";
      else if (action.includes("complet")) derivedCategory = "TASK_COMPLETED";
      else derivedCategory = "SYSTEM";
    }

    // SYSTEM events belong in the activity log — skip notification entirely
    if (derivedCategory === "SYSTEM") return null;

    const timestamp = new Date().toISOString();

    // Build content string
    let content = `${actor} ${action} ${resourceType}`;
    if (resourceName) content += ` "${resourceName}"`;
    if (Array.isArray(assignees) && assignees.length > 0)
      content += ` — assigned to: ${assignees.join(", ")}`;
    if (details) content += ` (${details})`;

    // Build targeted recipient set based on category
    const rawTargetSet = new Set();

    if (derivedCategory === "MENTIONED" || derivedCategory === "COMMENT_ADDED") {
      // Notify only the people directly involved — NOT all admins/managers
      if (actor) rawTargetSet.add(String(actor).trim());
      (Array.isArray(assignees) ? assignees : []).forEach((a) => {
        if (a) rawTargetSet.add(String(a).trim());
      });
    } else {
      // TASK_ASSIGNED, PROJECT_ASSIGNED, TASK_COMPLETED
      // Find all active employees with these roles
      const Employee = require("../models/Employee");
      const targetRoles = ["super-admin", "admin", "manager"];
      try {
        const managersAndAdmins = await Employee.find({
          status: "active",
          userRole: { $in: targetRoles }
        }).select("email name").lean();
        
        managersAndAdmins.forEach(u => {
          if (u.email) rawTargetSet.add(String(u.email).trim());
          if (u.name) rawTargetSet.add(String(u.name).trim());
        });
      } catch (err) {
        console.error("Failed to query managers and admins for notification:", err);
      }

      if (actor) rawTargetSet.add(String(actor).trim());
      (Array.isArray(assignees) ? assignees : []).forEach((a) => {
        if (a) rawTargetSet.add(String(a).trim());
      });
    }

    // Filter recipients based on their Settings webPreferences
    const Settings = require("../models/Settings");
    const User = require("../models/User");
    const Employee = require("../models/Employee");

    const targetSet = new Set();
    const map = {
      TASK_ASSIGNED: "taskAssignment",
      PROJECT_ASSIGNED: "projectAssignment",
      TASK_COMPLETED: "taskCompleted",
      MENTIONED: "replyAdded",
      COMMENT_ADDED: "commentAdded",
      EOD_MISS_ALERT: "eodMissAlert",
      EOD_COMMENT: "eodComment",
    };
    const prefKey = map[derivedCategory] || "systemAlert";

    for (const target of rawTargetSet) {
      try {
        let targetUser = await User.findOne({ username: target });
        if (!targetUser) {
          targetUser = await User.findOne({ name: target });
        }
        if (!targetUser) {
          const emp = await Employee.findOne({ $or: [{ email: target }, { name: target }] });
          if (emp) {
            targetUser = { _id: emp._id, username: emp.email };
          }
        }

        if (targetUser) {
          const settings = await Settings.findOne({ userId: String(targetUser._id) });
          const isWebEnabled = settings && settings.webPreferences ? settings.webPreferences[prefKey] : true;
          if (isWebEnabled !== false) {
            targetSet.add(target);
          }
        } else {
          targetSet.add(target);
        }
      } catch (err) {
        console.error(`Error checking web preference for target ${target}:`, err);
        targetSet.add(target);
      }
    }

    const recipient = Array.from(targetSet).join(",");

    // Leave meta.link empty for task/project — each panel's frontend computes
    // the correct route from resourceType + resourceId (avoids hardcoding /admin/ paths).
    const derivedLink = link || "";

    const titlePlain = `${action.charAt(0).toUpperCase() + action.slice(1)} ${resourceType}`;

    const notification = await Message.create({
      title: encrypt(titlePlain),
      sender: actor || "system",
      senderAvatar: "",
      recipient,
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

    // Real-time socket delivery — emit to each room in targetSet
    const io = global.io;
    if (io) {
      const payload = {
        ...notification.toObject(),
        id: String(notification._id),
        title: titlePlain,
        content,
        message: content,
      };
      Array.from(targetSet).forEach((room) => {
        io.to(room).emit("new-notification", payload);
      });
    }

    console.log(`[Notification] [${derivedCategory}] → [${recipient}]: ${content}`);
    return notification;
  } catch (err) {
    console.error("[Notification] Failed to create notification:", err);
    return null;
  }
}

module.exports = { createNotification };
