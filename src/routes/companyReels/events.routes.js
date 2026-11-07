const express = require("express");
const { trackReelEvent } = require("../../services/companyReels/eventService");

const router = express.Router();

/**
 * POST /api/company-reels/events
 * Ingests video playback telemetry and calculates server-side completion.
 */
router.post("/events", async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: { message: "Unauthorized" } });
    }

    const result = await trackReelEvent(userId, req.body);
    return res.json({ success: true, data: result });
  } catch (err) {
    console.error("[Company Reels] Error logging event:", err);
    return res.status(err.statusCode || 500).json({ error: { message: err.message || "Failed to log event" } });
  }
});

module.exports = router;
