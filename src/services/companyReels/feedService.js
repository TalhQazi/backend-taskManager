const mongoose = require("mongoose");
const CompanyReel = require("../../models/CompanyReel");
const CompanyQuizQuestion = require("../../models/CompanyQuizQuestion");
const UserReelProgress = require("../../models/UserReelProgress");
const ManagerBroadcast = require("../../models/ManagerBroadcast");
const Employee = require("../../models/Employee");

/**
 * Generates a rule-driven, personalized Company Reels™ feed for the employee.
 * 
 * Flow:
 * 1. Resolve employee context (role, department, location).
 * 2. Check for active priority/urgent ManagerBroadcasts.
 * 3. Fetch uncompleted Mandatory training reels (ordered by due date).
 * 4. Fetch Adaptive Reinforcement reels targeting recently failed quiz topics.
 * 5. Fetch role-appropriate general training, culture, and leadership content.
 * 6. Interleave using the 3:1:1 pacing engine (3 training reels : 1 quiz checkpoint : 1 culture/leadership reel).
 * 7. Strip sensitive server fields (e.g. correctAnswerId) before returning to client.
 */
async function getPersonalizedFeed(userId, userRole, options = {}) {
  const { limit = 20 } = options;

  let employee = null;
  if (mongoose.Types.ObjectId.isValid(userId)) {
    employee = await Employee.findById(userId).lean();
  }

  const role = (employee?.role || employee?.userRole || userRole || "employee").toLowerCase();
  const department = (employee?.department || "").toLowerCase();
  const location = (employee?.location || "").toLowerCase();

  // 1. Fetch user progress record
  let progress = null;
  if (mongoose.Types.ObjectId.isValid(userId)) {
    progress = await UserReelProgress.findOne({ userId }).lean();
  }
  const completedIds = new Set(
    (progress?.completedReels || []).map((c) => String(c.reelId))
  );
  const failedTopics = (progress?.failedTopics || [])
    .filter((f) => !f.resolved && f.failCount > 0)
    .map((f) => f.topic.toLowerCase());

  // 2. Urgent Manager Broadcasts
  const now = new Date();
  const broadcasts = await ManagerBroadcast.find({
    status: "active",
    publishAt: { $lte: now },
    $or: [{ expireAt: null }, { expireAt: { $gt: now } }],
  })
    .sort({ priority: -1, createdAt: -1 })
    .limit(2)
    .lean();

  // Filter broadcasts by scope and unacknowledged
  const validBroadcasts = broadcasts.filter((b) => {
    const alreadyAcked = (b.acknowledgedBy || []).some(
      (ack) => String(ack.userId) === String(userId)
    );
    if (alreadyAcked) return false;

    if (b.targetScope === "all") return true;
    const vals = (b.targetValues || []).map((v) => v.toLowerCase());
    if (b.targetScope === "role" && vals.includes(role)) return true;
    if (b.targetScope === "department" && vals.includes(department)) return true;
    if (b.targetScope === "location" && vals.includes(location)) return true;
    if (b.targetScope === "individual" && vals.includes(String(userId))) return true;
    return false;
  });

  // 3. Mandatory Reels (Uncompleted first, ordered by dueDate ascending)
  const roleQuery = {
    $or: [
      { applicableRoles: { $size: 0 } },
      { applicableRoles: { $in: [new RegExp(`^${role}$`, "i"), "all"] } },
    ],
  };

  const mandatoryReels = await CompanyReel.find({
    status: "published",
    isMandatory: true,
    ...roleQuery,
  })
    .populate("quizId", "-correctAnswerId")
    .sort({ dueDate: 1, priority: -1, createdAt: -1 })
    .limit(10)
    .lean();

  // Partition mandatory into uncompleted vs completed
  const uncompletedMandatory = mandatoryReels.filter(
    (r) => !completedIds.has(String(r._id))
  );

  // 4. Adaptive Reinforcement Reels (based on failed topics)
  let adaptiveReels = [];
  if (failedTopics.length > 0) {
    adaptiveReels = await CompanyReel.find({
      status: "published",
      $or: [
        { category: { $in: failedTopics } },
        { tags: { $in: failedTopics } },
      ],
      ...roleQuery,
    })
      .populate("quizId", "-correctAnswerId")
      .limit(4)
      .lean();
  }

  // 5. General Training Reels
  const generalTrainingReels = await CompanyReel.find({
    status: "published",
    isMandatory: false,
    category: { $in: ["training", "operations", "safety", "compliance"] },
    ...roleQuery,
  })
    .populate("quizId", "-correctAnswerId")
    .sort({ sortOrder: 1, createdAt: -1 })
    .limit(15)
    .lean();

  // 6. Culture & Leadership Reels
  const cultureReels = await CompanyReel.find({
    status: "published",
    category: { $in: ["culture", "leadership", "motivation"] },
    ...roleQuery,
  })
    .populate("quizId", "-correctAnswerId")
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();

  // 7. Sequence feed: Broadcasts -> Uncompleted Mandatory -> Adaptive -> Paced Queue (3:1:1)
  const feed = [];
  const seenReelIds = new Set();

  function pushReel(r, typeTag = "regular") {
    if (!r) return;
    const idStr = String(r._id);
    if (seenReelIds.has(idStr)) return;
    seenReelIds.add(idStr);
    feed.push({
      ...r,
      feedItemType: "reel",
      badgeType: typeTag,
      isCompleted: completedIds.has(idStr),
    });
  }

  // Inject broadcasts as special reel items
  for (const b of validBroadcasts) {
    feed.push({
      _id: b._id,
      title: b.title,
      description: b.description,
      mediaUrl: b.mediaUrl,
      thumbnailUrl: b.thumbnailUrl || "",
      category: "leadership",
      duration: 30,
      isMandatory: b.priority === "urgent",
      feedItemType: "broadcast",
      priority: b.priority,
      badgeType: "urgent_broadcast",
      requiresAcknowledgment: !!b.requiresAcknowledgment,
      isCompleted: false,
    });
  }

  // Push uncompleted mandatory first
  for (const r of uncompletedMandatory) {
    pushReel(r, "mandatory");
  }

  // Push adaptive reinforcement
  for (const r of adaptiveReels) {
    pushReel(r, "reinforcement");
  }

  // Interleave remaining training and culture reels
  let trainIdx = 0;
  let cultIdx = 0;
  while (feed.length < limit && (trainIdx < generalTrainingReels.length || cultIdx < cultureReels.length)) {
    // 3 training reels
    for (let i = 0; i < 3 && trainIdx < generalTrainingReels.length; i++) {
      pushReel(generalTrainingReels[trainIdx++], "training");
    }
    // 1 culture reel
    if (cultIdx < cultureReels.length) {
      pushReel(cultureReels[cultIdx++], "culture");
    }
  }

  return {
    items: feed,
    meta: {
      totalItems: feed.length,
      uncompletedMandatoryCount: uncompletedMandatory.length,
      currentStreak: progress?.currentStreak || 0,
      knowledgeScore: progress?.knowledgeScore || 100,
      totalPoints: progress?.totalPoints || 0,
      level: progress?.progressionLevel || 1,
    },
  };
}

/**
 * Returns mandatory training queue specifically for tracking due dates & compliance.
 */
async function getMandatoryQueue(userId, userRole) {
  let employee = null;
  if (mongoose.Types.ObjectId.isValid(userId)) {
    employee = await Employee.findById(userId).lean();
  }
  const role = (employee?.role || employee?.userRole || userRole || "employee").toLowerCase();

  let progress = null;
  if (mongoose.Types.ObjectId.isValid(userId)) {
    progress = await UserReelProgress.findOne({ userId }).lean();
  }
  const completedMap = new Map();
  for (const c of progress?.completedReels || []) {
    completedMap.set(String(c.reelId), c.completedAt);
  }

  const reels = await CompanyReel.find({
    status: "published",
    isMandatory: true,
    $or: [
      { applicableRoles: { $size: 0 } },
      { applicableRoles: { $in: [new RegExp(`^${role}$`, "i"), "all"] } },
    ],
  })
    .populate("quizId", "-correctAnswerId")
    .sort({ dueDate: 1, createdAt: -1 })
    .lean();

  const now = new Date();
  const mapped = reels.map((r) => {
    const isCompleted = completedMap.has(String(r._id));
    const isOverdue = !isCompleted && r.dueDate && new Date(r.dueDate) < now;
    return {
      ...r,
      isCompleted,
      completedAt: completedMap.get(String(r._id)) || null,
      isOverdue: !!isOverdue,
    };
  });

  return {
    total: mapped.length,
    completed: mapped.filter((m) => m.isCompleted).length,
    pending: mapped.filter((m) => !m.isCompleted).length,
    overdue: mapped.filter((m) => m.isOverdue).length,
    items: mapped,
  };
}

module.exports = {
  getPersonalizedFeed,
  getMandatoryQueue,
};
