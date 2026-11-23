const express = require("express");
const CompanyQuizQuestion = require("../../models/CompanyQuizQuestion");
const { submitQuizAnswer, getMissedQuestions } = require("../../services/companyReels/quizService");

const router = express.Router();

/**
 * GET /api/company-reels/quizzes/:id
 * Fetches a quiz question without revealing the correctAnswerId.
 */
router.get("/quizzes/:id", async (req, res) => {
  try {
    const question = await CompanyQuizQuestion.findById(req.params.id)
      .select("-correctAnswerId")
      .lean();
    if (!question) {
      return res.status(404).json({ error: { message: "Question not found" } });
    }
    return res.json({ success: true, data: question });
  } catch (err) {
    return res.status(500).json({ error: { message: err.message || "Failed to fetch question" } });
  }
});

/**
 * POST /api/company-reels/quizzes/:id/answer
 * Submits an answer, validates server-side, logs audit, and updates progress.
 */
router.post("/quizzes/:id/answer", async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const { selectedAnswerId, sourceReelId, responseTimeMs } = req.body;

    if (!selectedAnswerId) {
      return res.status(400).json({ error: { message: "selectedAnswerId is required" } });
    }

    const outcome = await submitQuizAnswer(userId, req.params.id, selectedAnswerId, {
      sourceReelId,
      responseTimeMs,
    });

    return res.json({ success: true, data: outcome });
  } catch (err) {
    console.error("[Company Reels] Error submitting quiz answer:", err);
    return res.status(err.statusCode || 500).json({ error: { message: err.message || "Failed to evaluate quiz" } });
  }
});

/**
 * GET /api/company-reels/users/me/missed-questions
 * Returns review cards for previously missed questions.
 */
router.get("/users/me/missed-questions", async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const list = await getMissedQuestions(userId);
    return res.json({ success: true, data: list });
  } catch (err) {
    return res.status(500).json({ error: { message: err.message || "Failed to fetch missed questions" } });
  }
});

module.exports = router;
