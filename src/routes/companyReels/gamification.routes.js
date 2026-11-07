const express = require("express");
const {
  getEmployeeProfile,
  getTeamLeaderboard,
  BADGE_CATALOG,
} = require("../../services/companyReels/gamificationService");

const router = express.Router();

/**
 * GET /api/company-reels/profile
 * Returns employee profile with stats, streak records, badges, and milestones.
 */
router.get("/profile", async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const profile = await getEmployeeProfile(userId);
    return res.json({ success: true, data: profile });
  } catch (err) {
    console.error("[Gamification] Profile fetch error:", err);
    return res.status(500).json({ error: { message: err.message || "Failed to fetch profile" } });
  }
});

/**
 * GET /api/company-reels/badges
 * Returns badge catalog with user unlock status.
 */
router.get("/badges", async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const profile = await getEmployeeProfile(userId);
    return res.json({
      success: true,
      data: {
        badges: profile.badges,
        unlockedCount: profile.unlockedBadgesCount,
        totalCount: profile.totalBadgesCount,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: { message: err.message || "Failed to fetch badges" } });
  }
});

/**
 * GET /api/company-reels/leaderboard
 * Returns team leaderboard ranked by points and streak.
 */
router.get("/leaderboard", async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const filter = req.query.filter || "all";
    const leaderboard = await getTeamLeaderboard(userId, filter);
    return res.json({ success: true, data: leaderboard });
  } catch (err) {
    console.error("[Gamification] Leaderboard fetch error:", err);
    return res.status(500).json({ error: { message: err.message || "Failed to fetch leaderboard" } });
  }
});

module.exports = router;
