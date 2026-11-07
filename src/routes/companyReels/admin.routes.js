const express = require("express");
const CompanyReel = require("../../models/CompanyReel");
const CompanyQuizQuestion = require("../../models/CompanyQuizQuestion");
const ManagerBroadcast = require("../../models/ManagerBroadcast");
const { getAdminAnalytics } = require("../../services/companyReels/analyticsService");
const { requireRole } = require("../../middleware/auth");

const router = express.Router();

// Restrict administrative actions to managers, admins, and super-admins
const allowedAdminRoles = ["admin", "super-admin", "manager"];

/**
 * GET /api/company-reels/admin/reels
 * Lists reels with filters for category, status, and search.
 */
router.get("/admin/reels", requireRole(allowedAdminRoles), async (req, res) => {
  try {
    const { category, status, search, isMandatory } = req.query;
    const query = {};

    if (category) query.category = category;
    if (status) query.status = status;
    if (isMandatory !== undefined) query.isMandatory = isMandatory === "true";
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
        { tags: { $in: [new RegExp(search, "i")] } },
      ];
    }

    const reels = await CompanyReel.find(query)
      .populate("quizId")
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ success: true, data: reels });
  } catch (err) {
    return res.status(500).json({ error: { message: err.message || "Failed to fetch reels" } });
  }
});

/**
 * POST /api/company-reels/admin/reels
 * Creates a new reel.
 */
router.post("/admin/reels", requireRole(allowedAdminRoles), async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const reelData = {
      ...req.body,
      ownerId: userId,
    };

    const newReel = await CompanyReel.create(reelData);
    return res.status(201).json({ success: true, data: newReel });
  } catch (err) {
    return res.status(400).json({ error: { message: err.message || "Failed to create reel" } });
  }
});

/**
 * PUT /api/company-reels/admin/reels/:id
 * Updates an existing reel.
 */
router.put("/admin/reels/:id", requireRole(allowedAdminRoles), async (req, res) => {
  try {
    const updated = await CompanyReel.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!updated) {
      return res.status(404).json({ error: { message: "Reel not found" } });
    }
    return res.json({ success: true, data: updated });
  } catch (err) {
    return res.status(400).json({ error: { message: err.message || "Failed to update reel" } });
  }
});

/**
 * DELETE /api/company-reels/admin/reels/:id
 * Soft-archives a reel.
 */
router.delete("/admin/reels/:id", requireRole(allowedAdminRoles), async (req, res) => {
  try {
    const updated = await CompanyReel.findByIdAndUpdate(
      req.params.id,
      { status: "archived" },
      { new: true }
    );
    if (!updated) {
      return res.status(404).json({ error: { message: "Reel not found" } });
    }
    return res.json({ success: true, data: updated });
  } catch (err) {
    return res.status(500).json({ error: { message: err.message || "Failed to archive reel" } });
  }
});

/**
 * GET /api/company-reels/admin/quizzes
 * Lists question bank questions.
 */
router.get("/admin/quizzes", requireRole(allowedAdminRoles), async (req, res) => {
  try {
    const questions = await CompanyQuizQuestion.find().sort({ createdAt: -1 }).lean();
    return res.json({ success: true, data: questions });
  } catch (err) {
    return res.status(500).json({ error: { message: err.message || "Failed to fetch quiz questions" } });
  }
});

/**
 * POST /api/company-reels/admin/quizzes
 * Creates a new quiz question and optionally links it to a reel.
 */
router.post("/admin/quizzes", requireRole(allowedAdminRoles), async (req, res) => {
  try {
    const { topic, question, answerOptions, correctAnswerId, explanation, difficulty, linkedReelId } = req.body;

    const newQuestion = await CompanyQuizQuestion.create({
      topic,
      question,
      answerOptions,
      correctAnswerId,
      explanation,
      difficulty,
      linkedReelId,
    });

    if (linkedReelId) {
      await CompanyReel.findByIdAndUpdate(linkedReelId, { quizId: newQuestion._id });
    }

    return res.status(201).json({ success: true, data: newQuestion });
  } catch (err) {
    return res.status(400).json({ error: { message: err.message || "Failed to create quiz question" } });
  }
});

/**
 * GET /api/company-reels/admin/analytics
 * Returns enterprise metrics, compliance, and risk highlights.
 */
router.get("/admin/analytics", requireRole(allowedAdminRoles), async (req, res) => {
  try {
    const data = await getAdminAnalytics();
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ error: { message: err.message || "Failed to load analytics" } });
  }
});

/**
 * POST /api/company-reels/admin/broadcasts
 * Pushes an urgent or normal manager broadcast video.
 */
router.post("/admin/broadcasts", requireRole(allowedAdminRoles), async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const broadcast = await ManagerBroadcast.create({
      ...req.body,
      createdBy: userId,
    });
    return res.status(201).json({ success: true, data: broadcast });
  } catch (err) {
    return res.status(400).json({ error: { message: err.message || "Failed to create broadcast" } });
  }
});

module.exports = router;
