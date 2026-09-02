const express = require("express");
const {
  createBroadcast,
  getActiveUserBroadcasts,
  acknowledgeBroadcast,
  getManagerBroadcasts,
} = require("../../services/companyReels/broadcastService");
const { requireRole } = require("../../middleware/auth");

const router = express.Router();
const allowedBroadcastRoles = ["admin", "super-admin", "manager"];

/**
 * POST /api/company-reels/broadcasts
 * Manager or Admin posts an executive video broadcast.
 */
router.post("/broadcasts", requireRole(allowedBroadcastRoles), async (req, res) => {
  try {
    const senderId = req.user?._id || req.user?.id;
    const senderRole = req.user?.role;
    const broadcast = await createBroadcast(senderId, senderRole, req.body);
    return res.status(201).json({ success: true, data: broadcast });
  } catch (err) {
    console.error("[Broadcast] Create error:", err);
    return res.status(err.statusCode || 500).json({ error: { message: err.message || "Failed to create broadcast" } });
  }
});

/**
 * GET /api/company-reels/broadcasts/active
 * Returns any unacknowledged urgent broadcasts interrupting the employee's feed.
 */
router.get("/broadcasts/active", async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const active = await getActiveUserBroadcasts(userId);
    return res.json({ success: true, data: active });
  } catch (err) {
    return res.status(500).json({ error: { message: err.message || "Failed to fetch active broadcasts" } });
  }
});

/**
 * POST /api/company-reels/broadcasts/:id/acknowledge
 * Submits employee compliance acknowledgment.
 */
router.post("/broadcasts/:id/acknowledge", async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const { note } = req.body;
    const result = await acknowledgeBroadcast(req.params.id, userId, note);
    return res.json(result);
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: { message: err.message || "Failed to acknowledge broadcast" } });
  }
});

/**
 * GET /api/company-reels/broadcasts/sent
 * Returns history of broadcasts created by the manager.
 */
router.get("/broadcasts/sent", requireRole(allowedBroadcastRoles), async (req, res) => {
  try {
    const senderId = req.user?._id || req.user?.id;
    const sent = await getManagerBroadcasts(senderId);
    return res.json({ success: true, data: sent });
  } catch (err) {
    return res.status(500).json({ error: { message: err.message || "Failed to fetch sent broadcasts" } });
  }
});

module.exports = router;
