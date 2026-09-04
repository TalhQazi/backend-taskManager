const express = require("express");
const { requireAuth } = require("../../middleware/auth");

const feedRoutes = require("./feed.routes");
const eventRoutes = require("./events.routes");
const quizRoutes = require("./quizzes.routes");
const progressRoutes = require("./progress.routes");
const adminRoutes = require("./admin.routes");
const trainingPathsRoutes = require("./trainingPaths.routes");
const gamificationRoutes = require("./gamification.routes");
const broadcastRoutes = require("./broadcast.routes");
const auditRoutes = require("./audit.routes");

const router = express.Router();

// Enforce standard JWT authentication across all Company Reels™ endpoints
router.use(requireAuth);

router.get("/health", (req, res) => {
  res.json({ ok: true, module: "company-reels", version: "1.0.0" });
});

router.use("/", feedRoutes);
router.use("/", eventRoutes);
router.use("/", quizRoutes);
router.use("/", progressRoutes);
router.use("/", adminRoutes);
router.use("/", trainingPathsRoutes);
router.use("/", gamificationRoutes);
router.use("/", broadcastRoutes);
router.use("/", auditRoutes);

module.exports = router;
