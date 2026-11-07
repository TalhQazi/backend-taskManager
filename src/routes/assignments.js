const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { attachActor, requireManager } = require("../middleware/wipPermissions");
const ctrl = require("../controllers/workAssignmentController");

const router = express.Router();
router.use(requireAuth, attachActor);

// Core lifecycle endpoints
router.post("/", ctrl.createAssignment);
router.post("/:id/start", ctrl.startAssignment);
router.post("/:id/pause", ctrl.pauseAssignment);
router.post("/:id/resume", ctrl.resumeAssignment);
router.post("/:id/block", ctrl.blockAssignment);
router.post("/:id/unblock", ctrl.unblockAssignment);
router.post("/:id/switch", ctrl.switchAssignment);
router.patch("/:id/estimate", ctrl.updateEstimate);
router.patch("/:id/progress", ctrl.updateProgress);
router.post("/:id/complete", ctrl.completeAssignment);

module.exports = router;
