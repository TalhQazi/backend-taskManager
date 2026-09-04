const express = require("express");
const { getPersonalizedFeed, getMandatoryQueue } = require("../../services/companyReels/feedService");

const router = express.Router();

/**
 * GET /api/company-reels/feed
 * Returns the personalized, rule-driven reels feed for the employee.
 */
router.get("/feed", async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const userRole = req.user?.role;
    const limit = parseInt(req.query.limit, 10) || 20;

    const feedData = await getPersonalizedFeed(userId, userRole, { limit });
    return res.json({ success: true, data: feedData });
  } catch (err) {
    console.error("[Company Reels] Error generating feed:", err);
    return res.status(500).json({ error: { message: err.message || "Failed to generate feed" } });
  }
});

/**
 * GET /api/company-reels/mandatory
 * Returns the employee's mandatory training queue.
 */
router.get("/mandatory", async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const userRole = req.user?.role;

    const mandatoryData = await getMandatoryQueue(userId, userRole);
    return res.json({ success: true, data: mandatoryData });
  } catch (err) {
    console.error("[Company Reels] Error fetching mandatory queue:", err);
    return res.status(500).json({ error: { message: err.message || "Failed to fetch mandatory queue" } });
  }
});

module.exports = router;
