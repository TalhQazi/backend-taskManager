const mongoose = require("mongoose");
const ManagerBroadcast = require("../../models/ManagerBroadcast");
const Employee = require("../../models/Employee");
const UserReelEvent = require("../../models/UserReelEvent");

/**
 * Creates an executive or manager video broadcast.
 */
async function createBroadcast(senderId, senderRole, data) {
  const {
    title,
    description,
    mediaUrl,
    thumbnailUrl,
    targetScope = "all",
    targetValues = [],
    priority = "urgent",
    requiresAcknowledgment = true,
    expireDays = 14,
  } = data;

  if (!title || !mediaUrl) {
    const err = new Error("Title and mediaUrl are required.");
    err.statusCode = 400;
    throw err;
  }

  const now = new Date();
  const expireAt = new Date(now.getTime() + expireDays * 24 * 60 * 60 * 1000);

  const broadcast = await ManagerBroadcast.create({
    title,
    description,
    mediaUrl,
    thumbnailUrl,
    targetScope,
    targetValues: Array.isArray(targetValues) ? targetValues : [targetValues].filter(Boolean),
    priority,
    requiresAcknowledgment,
    expireAt,
    createdBy: senderId,
    status: "active",
  });

  return broadcast;
}

/**
 * Resolves active unacknowledged broadcasts interrupting the employee's feed.
 */
async function getActiveUserBroadcasts(userId) {
  let employee = null;
  if (mongoose.Types.ObjectId.isValid(userId)) {
    employee = await Employee.findById(userId).lean();
  }

  const role = (employee?.role || employee?.userRole || "employee").toLowerCase();
  const department = (employee?.department || "").toLowerCase();
  const location = (employee?.location || "").toLowerCase();

  const now = new Date();

  // Find active, non-expired broadcasts
  const broadcasts = await ManagerBroadcast.find({
    status: "active",
    $or: [{ expireAt: null }, { expireAt: { $gt: now } }],
  })
    .populate("createdBy", "firstName lastName name role")
    .sort({ priority: -1, createdAt: -1 })
    .lean();

  const applicable = [];

  for (const b of broadcasts) {
    // Check scoping
    let matchesScope = false;
    if (b.targetScope === "all") {
      matchesScope = true;
    } else if (b.targetScope === "role" && b.targetValues.some((v) => v.toLowerCase() === role)) {
      matchesScope = true;
    } else if (b.targetScope === "department" && b.targetValues.some((v) => v.toLowerCase() === department)) {
      matchesScope = true;
    } else if (b.targetScope === "location" && b.targetValues.some((v) => v.toLowerCase() === location)) {
      matchesScope = true;
    }

    if (!matchesScope) continue;

    // Check if user already acknowledged
    const alreadyAcked = (b.acknowledgedBy || []).some(
      (ack) => String(ack.userId) === String(userId)
    );

    if (!alreadyAcked) {
      applicable.push({
        _id: b._id,
        title: b.title,
        description: b.description,
        mediaUrl: b.mediaUrl,
        thumbnailUrl: b.thumbnailUrl,
        priority: b.priority,
        requiresAcknowledgment: b.requiresAcknowledgment,
        sender: b.createdBy,
        createdAt: b.createdAt,
      });
    }
  }

  return applicable;
}

/**
 * Submits employee acknowledgment for a broadcast.
 */
async function acknowledgeBroadcast(broadcastId, userId, note = "") {
  const broadcast = await ManagerBroadcast.findById(broadcastId);
  if (!broadcast) {
    const err = new Error("Broadcast not found");
    err.statusCode = 404;
    throw err;
  }

  const alreadyAcked = (broadcast.acknowledgedBy || []).some(
    (ack) => String(ack.userId) === String(userId)
  );

  if (!alreadyAcked) {
    broadcast.acknowledgedBy.push({
      userId,
      acknowledgedAt: new Date(),
      note,
    });
    await broadcast.save();

    // Log compliance audit event
    try {
      await UserReelEvent.create({
        userId,
        reelId: broadcast._id,
        eventType: "broadcast_acknowledged",
        completed: true,
        startedAt: new Date(),
        metadata: {
          broadcastTitle: broadcast.title,
          priority: broadcast.priority,
          note,
        },
      });
    } catch (e) {
      console.warn("[Broadcast] Audit log notice:", e.message);
    }
  }

  return { success: true, acknowledged: true };
}

/**
 * Lists broadcasts sent by a manager with engagement/acknowledgment metrics.
 */
async function getManagerBroadcasts(senderId) {
  const broadcasts = await ManagerBroadcast.find({ createdBy: senderId })
    .sort({ createdAt: -1 })
    .lean();

  return broadcasts.map((b) => ({
    _id: b._id,
    title: b.title,
    description: b.description,
    priority: b.priority,
    status: b.status,
    requiresAcknowledgment: b.requiresAcknowledgment,
    totalAcknowledged: (b.acknowledgedBy || []).length,
    createdAt: b.createdAt,
    expireAt: b.expireAt,
  }));
}

module.exports = {
  createBroadcast,
  getActiveUserBroadcasts,
  acknowledgeBroadcast,
  getManagerBroadcasts,
};
