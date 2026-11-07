const Poll = require("../models/Poll");
const PollAudience = require("../models/PollAudience");
const PollAuditLog = require("../models/PollAuditLog");
const { createNotification } = require("../utils/notifications");
const { sendEmailNotification } = require("../utils/emailNotifications");
const Employee = require("../models/Employee");
const mongoose = require("mongoose");

function escapeRegExp(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function resolveAudienceEmployees(audiences) {
  if (!audiences || audiences.length === 0 || audiences.some((a) => a.targetType === "global")) {
    return Employee.find({ status: { $ne: "inactive" }, userStatus: { $ne: "inactive" } })
      .select("_id name email")
      .lean();
  }
  const or = [];
  for (const t of audiences) {
    const type = String(t.targetType || "").toLowerCase();
    const id = String(t.targetId || "").trim();
    if (type === "company" && id) or.push({ company: new RegExp(`^${escapeRegExp(id)}$`, "i") });
    if (type === "department" && id) or.push({ department: new RegExp(`^${escapeRegExp(id)}$`, "i") });
    if (type === "location" && id) {
      or.push({ location: new RegExp(`^${escapeRegExp(id)}$`, "i") });
      if (mongoose.Types.ObjectId.isValid(id)) or.push({ locationId: id });
    }
    if (type === "role" && id) or.push({ userRole: new RegExp(`^${escapeRegExp(id)}$`, "i") });
    if (type === "user" && id) {
      or.push({ email: new RegExp(`^${escapeRegExp(id)}$`, "i") });
      or.push({ name: new RegExp(`^${escapeRegExp(id)}$`, "i") });
      if (mongoose.Types.ObjectId.isValid(id)) or.push({ _id: id });
    }
  }
  if (!or.length) return [];
  return Employee.find({ status: { $ne: "inactive" }, $or: or }).select("_id name email").lean();
}

async function publishScheduledPolls() {
  const now = new Date();
  const due = await Poll.find({ status: "scheduled", scheduledAt: { $lte: now } });
  console.log(`[Poll Scheduler] Publishing ${due.length} scheduled poll(s)`);

  for (const poll of due) {
    poll.status = "active";
    poll.publishedAt = now;
    await poll.save();

    const audiences = await PollAudience.find({ pollId: poll._id }).lean();
    const employees = await resolveAudienceEmployees(audiences);
    await Poll.updateOne({ _id: poll._id }, { $set: { audienceCount: employees.length } });

    const tokens = employees.flatMap((e) => [e.email, e.name, String(e._id)]).filter(Boolean);
    if (poll.sendInApp !== false) {
      await createNotification({
        actor: poll.creatorName || "System",
        actorRole: poll.creatorRole || "admin",
        action: "published poll",
        resourceType: "poll",
        resourceName: poll.title,
        assignees: tokens,
        resourceId: String(poll._id),
        category: "POLL_ASSIGNED",
        link: "/employee/polls",
      }).catch(() => {});
    }
    if (poll.sendEmail) {
      for (const emp of employees) {
        const target = emp.email || emp.name;
        if (!target) continue;
        await sendEmailNotification(target, "pollAssignment", {
          name: emp.name || "Team Member",
          pollTitle: poll.title,
          pollDescription: poll.description || "",
          closesAt: poll.closesAt ? new Date(poll.closesAt).toLocaleString() : "No deadline",
        }).catch(() => {});
      }
    }

    await PollAuditLog.create({
      pollId: poll._id,
      actorId: "system",
      actorName: "Scheduler",
      actorRole: "system",
      action: "auto_published",
      meta: {},
    }).catch(() => {});

    if (global.io) {
      global.io.emit("poll-published", { id: String(poll._id), title: poll.title });
    }
  }
}

async function closeExpiredPolls() {
  const now = new Date();
  const expired = await Poll.find({
    status: "active",
    closesAt: { $ne: null, $lte: now },
  });
  console.log(`[Poll Scheduler] Closing ${expired.length} expired poll(s)`);

  for (const poll of expired) {
    poll.status = "closed";
    poll.closedAt = now;
    await poll.save();
    await PollAuditLog.create({
      pollId: poll._id,
      actorId: "system",
      actorName: "Scheduler",
      actorRole: "system",
      action: "auto_closed",
      meta: {},
    }).catch(() => {});
    if (global.io) {
      global.io.emit("poll-closed", { id: String(poll._id), title: poll.title });
    }
  }
}

async function runPollScheduler() {
  await publishScheduledPolls();
  await closeExpiredPolls();
}

module.exports = { runPollScheduler, publishScheduledPolls, closeExpiredPolls };
