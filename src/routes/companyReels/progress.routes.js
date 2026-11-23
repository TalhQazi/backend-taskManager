const express = require("express");
const UserReelProgress = require("../../models/UserReelProgress");
const CompanyReel = require("../../models/CompanyReel");

const router = express.Router();

/**
 * GET /api/company-reels/progress
 * Returns user-level progress stats (streak, points, knowledge score, completed count).
 */
router.get("/progress", async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    let progress = await UserReelProgress.findOne({ userId })
      .populate("completedReels.reelId", "title category duration thumbnailUrl")
      .lean();

    if (!progress) {
      progress = {
        userId,
        completedReels: [],
        currentStreak: 0,
        longestStreak: 0,
        knowledgeScore: 100,
        totalPoints: 0,
        progressionLevel: 1,
        badges: [],
        failedTopics: [],
        certifications: [],
      };
    }

    const totalPublished = await CompanyReel.countDocuments({ status: "published" });

    return res.json({
      success: true,
      data: {
        ...progress,
        totalPublishedReels: totalPublished,
        completionPercentage:
          totalPublished > 0
            ? Math.min(100, Math.round(((progress.completedReels || []).length / totalPublished) * 100))
            : 0,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: { message: err.message || "Failed to fetch progress" } });
  }
});

/**
 * GET /api/company-reels/certifications
 * Returns user certifications.
 */
router.get("/certifications", async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const progress = await UserReelProgress.findOne({ userId }).select("certifications progressionLevel").lean();

    return res.json({
      success: true,
      data: {
        level: progress?.progressionLevel || 1,
        certifications: progress?.certifications || [],
      },
    });
  } catch (err) {
    return res.status(500).json({ error: { message: err.message || "Failed to fetch certifications" } });
  }
});

/**
 * GET /api/company-reels/rewards
 * Returns badges and gamification achievements.
 */
router.get("/rewards", async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const progress = await UserReelProgress.findOne({ userId })
      .select("totalPoints currentStreak longestStreak badges")
      .lean();

    return res.json({
      success: true,
      data: {
        points: progress?.totalPoints || 0,
        streak: progress?.currentStreak || 0,
        longestStreak: progress?.longestStreak || 0,
        badges: progress?.badges || [],
      },
    });
  } catch (err) {
    return res.status(500).json({ error: { message: err.message || "Failed to fetch rewards" } });
  }
});

module.exports = router;
