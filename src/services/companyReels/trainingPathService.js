const mongoose = require("mongoose");
const CompanyTrainingPath = require("../../models/CompanyTrainingPath");
const CompanyReel = require("../../models/CompanyReel");
const UserReelProgress = require("../../models/UserReelProgress");
const Employee = require("../../models/Employee");

/**
 * Service managing sequenced training curriculum paths, progressive unlocking,
 * and resume points for employees.
 */
async function getUserTrainingPaths(userId, userRole) {
  let employee = null;
  if (mongoose.Types.ObjectId.isValid(userId)) {
    employee = await Employee.findById(userId).lean();
  }
  const role = (employee?.role || employee?.userRole || userRole || "employee").toLowerCase();
  const department = (employee?.department || "").toLowerCase();

  let progress = null;
  if (mongoose.Types.ObjectId.isValid(userId)) {
    progress = await UserReelProgress.findOne({ userId }).lean();
  }
  const completedReelIds = new Set((progress?.completedReels || []).map((c) => String(c.reelId)));

  const paths = await CompanyTrainingPath.find({
    status: "active",
    $or: [
      { roleScope: { $size: 0 } },
      { roleScope: { $in: [new RegExp(`^${role}$`, "i"), "all"] } },
    ],
  })
    .populate("items.reelId", "title duration category thumbnailUrl isMandatory")
    .populate("items.requiredQuizId", "topic question difficulty")
    .sort({ required: -1, createdAt: -1 })
    .lean();

  const mapped = paths.map((path) => {
    let completedCount = 0;
    let nextItem = null;

    const itemsWithStatus = (path.items || []).map((item, index) => {
      const reelIdStr = String(item.reelId?._id || item.reelId);
      const isCompleted = completedReelIds.has(reelIdStr);
      if (isCompleted) completedCount += 1;

      // First uncompleted item becomes the active resume point
      if (!isCompleted && !nextItem) {
        nextItem = {
          ...item,
          index,
        };
      }

      return {
        ...item,
        isCompleted,
      };
    });

    const totalItems = path.items.length;
    const progressPercent = totalItems > 0 ? Math.round((completedCount / totalItems) * 100) : 0;
    const isCompleted = totalItems > 0 && completedCount === totalItems;

    return {
      _id: path._id,
      name: path.name,
      description: path.description,
      type: path.type,
      required: path.required,
      recurrenceRule: path.recurrenceRule,
      totalItems,
      completedItems: completedCount,
      progressPercent,
      isCompleted,
      nextPendingItem: nextItem,
      items: itemsWithStatus,
    };
  });

  return mapped;
}

/**
 * Returns the exact resume node for "Continue Where You Left Off".
 */
async function getContinueTraining(userId, userRole) {
  const paths = await getUserTrainingPaths(userId, userRole);
  
  // Prioritize mandatory incomplete paths first
  const inProgress = paths.filter((p) => !p.isCompleted && p.nextPendingItem);
  if (inProgress.length === 0) return null;

  // Sort mandatory first, then by highest progress
  inProgress.sort((a, b) => {
    if (a.required !== b.required) return a.required ? -1 : 1;
    return b.progressPercent - a.progressPercent;
  });

  const activePath = inProgress[0];
  const nextItem = activePath.nextPendingItem;

  return {
    pathId: activePath._id,
    pathName: activePath.name,
    pathType: activePath.type,
    progressPercent: activePath.progressPercent,
    completedItems: activePath.completedItems,
    totalItems: activePath.totalItems,
    reel: nextItem.reelId,
    quizId: nextItem.requiredQuizId,
    sequenceOrder: nextItem.sequenceOrder,
  };
}

/**
 * Returns complete step breakdown with sequential lock gates.
 */
async function getTrainingPathDetails(pathId, userId) {
  let progress = null;
  if (mongoose.Types.ObjectId.isValid(userId)) {
    progress = await UserReelProgress.findOne({ userId }).lean();
  }
  const completedReelIds = new Set((progress?.completedReels || []).map((c) => String(c.reelId)));

  const path = await CompanyTrainingPath.findById(pathId)
    .populate("items.reelId")
    .populate("items.requiredQuizId", "-correctAnswerId")
    .lean();

  if (!path) {
    const error = new Error("Training path not found");
    error.statusCode = 404;
    throw error;
  }

  let unlocked = true;
  const items = (path.items || []).map((item, index) => {
    const reelIdStr = String(item.reelId?._id || item.reelId);
    const isCompleted = completedReelIds.has(reelIdStr);
    const isCurrent = unlocked && !isCompleted;
    const isLocked = !unlocked;

    // After the first uncompleted item, subsequent items are locked
    if (!isCompleted) {
      unlocked = false;
    }

    return {
      ...item,
      isCompleted,
      isCurrent,
      isLocked,
      stepNumber: index + 1,
    };
  });

  return {
    ...path,
    items,
  };
}

module.exports = {
  getUserTrainingPaths,
  getContinueTraining,
  getTrainingPathDetails,
};
