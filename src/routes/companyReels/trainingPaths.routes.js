const express = require("express");
const CompanyTrainingPath = require("../../models/CompanyTrainingPath");
const {
  getUserTrainingPaths,
  getContinueTraining,
  getTrainingPathDetails,
} = require("../../services/companyReels/trainingPathService");
const { getUserCertifications } = require("../../services/companyReels/certificationService");
const { retakeQuizAnswer } = require("../../services/companyReels/quizService");
const { requireRole } = require("../../middleware/auth");

const router = express.Router();
const allowedAdminRoles = ["admin", "super-admin", "manager"];

/**
 * GET /api/company-reels/training-paths
 * Returns structured curriculum paths available to the current employee.
 */
router.get("/training-paths", async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const userRole = req.user?.role;

    const paths = await getUserTrainingPaths(userId, userRole);
    return res.json({ success: true, data: paths });
  } catch (err) {
    console.error("[Company Reels] Error fetching training paths:", err);
    return res.status(500).json({ error: { message: err.message || "Failed to fetch training paths" } });
  }
});

/**
 * GET /api/company-reels/training-paths/continue
 * Helper returning the next uncompleted step across active paths.
 */
router.get("/training-paths/continue", async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const userRole = req.user?.role;

    const continueData = await getContinueTraining(userId, userRole);
    return res.json({ success: true, data: continueData });
  } catch (err) {
    return res.status(500).json({ error: { message: err.message || "Failed to resolve continue item" } });
  }
});

/**
 * GET /api/company-reels/training-paths/:id
 * Returns complete sequential path details with lock gates.
 */
router.get("/training-paths/:id", async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const details = await getTrainingPathDetails(req.params.id, userId);
    return res.json({ success: true, data: details });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: { message: err.message || "Failed to fetch path details" } });
  }
});

/**
 * GET /api/company-reels/certifications
 * Returns user certifications and 4-level progression ladder.
 */
router.get("/certifications", async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const certs = await getUserCertifications(userId);
    return res.json({ success: true, data: certs });
  } catch (err) {
    return res.status(500).json({ error: { message: err.message || "Failed to fetch certifications" } });
  }
});

/**
 * POST /api/company-reels/quizzes/:id/retake
 * Retakes a missed question from the review center.
 */
router.post("/quizzes/:id/retake", async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const { selectedAnswerId } = req.body;

    if (!selectedAnswerId) {
      return res.status(400).json({ error: { message: "selectedAnswerId is required" } });
    }

    const outcome = await retakeQuizAnswer(userId, req.params.id, selectedAnswerId);
    return res.json({ success: true, data: outcome });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: { message: err.message || "Retake failed" } });
  }
});

/**
 * POST /api/company-reels/admin/training-paths
 * Admin creates a new curriculum training path.
 */
router.post("/admin/training-paths", requireRole(allowedAdminRoles), async (req, res) => {
  try {
    const newPath = await CompanyTrainingPath.create(req.body);
    return res.status(201).json({ success: true, data: newPath });
  } catch (err) {
    return res.status(400).json({ error: { message: err.message || "Failed to create training path" } });
  }
});

/**
 * PUT /api/company-reels/admin/training-paths/:id
 * Admin updates training path items or scoping.
 */
router.put("/admin/training-paths/:id", requireRole(allowedAdminRoles), async (req, res) => {
  try {
    const updated = await CompanyTrainingPath.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!updated) {
      return res.status(404).json({ error: { message: "Training path not found" } });
    }
    return res.json({ success: true, data: updated });
  } catch (err) {
    return res.status(400).json({ error: { message: err.message || "Failed to update training path" } });
  }
});

/**
 * DELETE /api/company-reels/admin/training-paths/:id
 * Admin archives a training path.
 */
router.delete("/admin/training-paths/:id", requireRole(allowedAdminRoles), async (req, res) => {
  try {
    const updated = await CompanyTrainingPath.findByIdAndUpdate(
      req.params.id,
      { status: "archived" },
      { new: true }
    );
    if (!updated) {
      return res.status(404).json({ error: { message: "Training path not found" } });
    }
    return res.json({ success: true, data: updated });
  } catch (err) {
    return res.status(500).json({ error: { message: err.message || "Failed to archive path" } });
  }
});

module.exports = router;
