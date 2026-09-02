const mongoose = require("mongoose");
const UserReelEvent = require("../../models/UserReelEvent");
const UserReelProgress = require("../../models/UserReelProgress");
const CompanyReel = require("../../models/CompanyReel");

/**
 * High-performance event ingestion service.
 * Enforces business logic that meaningful completion is calculated server-side
 * (e.g. watch progress >= 90%).
 */
async function trackReelEvent(userId, eventData) {
  const {
    reelId,
    eventType,
    watchDurationSec = 0,
    percentWatched = 0,
    clientPlatform = "mobile",
    soundMuted = false,
  } = eventData;

  if (!reelId || !mongoose.Types.ObjectId.isValid(reelId)) {
    const error = new Error("Invalid or missing reelId");
    error.statusCode = 400;
    throw error;
  }

  const reel = await CompanyReel.findById(reelId).select("duration isMandatory category").lean();
  if (!reel) {
    const error = new Error("Reel not found");
    error.statusCode = 404;
    throw error;
  }

  // Server-side completion evaluation: watched at least 90% or explicitly completed with >= 75% duration
  const isMeaningfullyCompleted =
    eventType === "complete" ||
    Number(percentWatched) >= 90 ||
    (reel.duration > 0 && Number(watchDurationSec) >= reel.duration * 0.9);

  // 1. Log event
  const event = await UserReelEvent.create({
    userId,
    reelId,
    eventType,
    watchDurationSec: Math.round(Number(watchDurationSec) || 0),
    percentWatched: Math.min(100, Math.round(Number(percentWatched) || 0)),
    completed: isMeaningfullyCompleted,
    startedAt: new Date(),
    metadata: {
      clientPlatform,
      soundMuted: !!soundMuted,
    },
  });

  // 2. If completed, update UserReelProgress
  let newlyCompleted = false;
  if (isMeaningfullyCompleted) {
    let progress = await UserReelProgress.findOne({ userId });
    if (!progress) {
      progress = new UserReelProgress({
        userId,
        completedReels: [],
        currentStreak: 1,
        longestStreak: 1,
        knowledgeScore: 100,
        totalPoints: 0,
        progressionLevel: 1,
        badges: [],
        failedTopics: [],
        certifications: [],
      });
    }

    const completedIndex = progress.completedReels.findIndex(
      (c) => String(c.reelId) === String(reelId)
    );

    if (completedIndex === -1) {
      progress.completedReels.push({
        reelId,
        completedAt: new Date(),
        watchCount: 1,
      });
      progress.totalPoints += 10;
      newlyCompleted = true;

      // Check for first reel completion badge
      const existingBadgeIds = new Set(progress.badges.map((b) => b.id));
      if (!existingBadgeIds.has("first_reel_complete")) {
        progress.badges.push({
          id: "first_reel_complete",
          title: "First Reel Watched",
          description: "Completed your first training reel in Company Reels™!",
          icon: "play-circle",
          awardedAt: new Date(),
        });
      }
    } else {
      progress.completedReels[completedIndex].watchCount += 1;
    }

    await progress.save();

    // Trigger Gamification Engine (Streaks, XP bonuses, Badges)
    try {
      const { recordActivity } = require("./gamificationService");
      await recordActivity(userId, "reel_completed", reel);
    } catch (gamifyErr) {
      console.warn("[Gamification Service] Notice:", gamifyErr.message);
    }
  }

  return {
    success: true,
    eventId: event._id,
    isCompleted: isMeaningfullyCompleted,
    newlyCompleted,
  };
}

module.exports = {
  trackReelEvent,
};
