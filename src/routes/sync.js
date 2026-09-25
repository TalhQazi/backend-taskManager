const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/auth");
const {
  pushSync,
  pullSync,
  getStatus,
} = require("../controllers/syncController");

/**
 * @route   POST /api/sync/push
 * @desc    Process batched offline mutations with idempotency and monotonic LSN logging
 * @access  Private
 */
router.post("/push", requireAuth, pushSync);

/**
 * @route   POST /api/sync/pull
 * @desc    Fetch incremental delta changes after a given LSN cursor
 * @access  Private
 */
router.post("/pull", requireAuth, pullSync);

/**
 * @route   GET /api/sync/status
 * @desc    Get current sync sequence counter and server timestamp
 * @access  Private
 */
router.get("/status", requireAuth, getStatus);

module.exports = router;
