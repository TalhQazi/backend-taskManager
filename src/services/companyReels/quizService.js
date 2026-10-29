const mongoose = require("mongoose");
const CompanyQuizQuestion = require("../../models/CompanyQuizQuestion");
const UserQuizEvent = require("../../models/UserQuizEvent");
const UserReelProgress = require("../../models/UserReelProgress");

/**
 * Validates a micro-quiz response entirely server-side, updates user telemetry,
 * tracks adaptive knowledge gaps, and rewards the user.
 */
async function submitQuizAnswer(userId, questionId, selectedAnswerId, meta = {}) {
  const { sourceReelId, responseTimeMs = 0 } = meta;

  const question = await CompanyQuizQuestion.findById(questionId);
  if (!question) {
    const error = new Error("Quiz question not found");
    error.statusCode = 404;
    throw error;
  }

  const isCorrect = String(question.correctAnswerId).trim() === String(selectedAnswerId).trim();

  // 1. Log permanent UserQuizEvent audit record
  await UserQuizEvent.create({
    userId,
    questionId: question._id,
    sourceReelId: sourceReelId && mongoose.Types.ObjectId.isValid(sourceReelId) ? sourceReelId : null,
    selectedAnswerId,
    correct: isCorrect,
    topic: question.topic,
    responseTimeMs,
    answeredAt: new Date(),
  });

  // 2. Fetch or create UserReelProgress
  let progress = await UserReelProgress.findOne({ userId });
  if (!progress) {
    progress = new UserReelProgress({
      userId,
      completedReels: [],
      currentStreak: 0,
      longestStreak: 0,
      knowledgeScore: 100,
      totalPoints: 0,
      progressionLevel: 1,
      badges: [],
      failedTopics: [],
      certifications: [],
    });
  }

  // 3. Update Streak
  const today = new Date().toISOString().split("T")[0];
  if (progress.lastActiveDate !== today) {
    if (progress.lastActiveDate) {
      const last = new Date(progress.lastActiveDate);
      const cur = new Date(today);
      const diffDays = Math.round((cur - last) / (1000 * 60 * 60 * 24));
      if (diffDays === 1) {
        progress.currentStreak += 1;
      } else if (diffDays > 1) {
        progress.currentStreak = 1;
      }
    } else {
      progress.currentStreak = 1;
    }
    progress.lastActiveDate = today;
    if (progress.currentStreak > progress.longestStreak) {
      progress.longestStreak = progress.currentStreak;
    }
  }

  // 4. Update Points & Adaptive Topics
  let pointsAwarded = 0;
  let newBadge = null;

  if (isCorrect) {
    pointsAwarded = 25;
    progress.totalPoints += pointsAwarded;

    // Adaptive Spaced Repetition: track consecutive passes (mastery requires 3 consecutive passes)
    const failedTopicIndex = progress.failedTopics.findIndex(
      (f) => f.topic.toLowerCase() === question.topic.toLowerCase()
    );
    if (failedTopicIndex !== -1) {
      progress.failedTopics[failedTopicIndex].consecutivePasses =
        (progress.failedTopics[failedTopicIndex].consecutivePasses || 0) + 1;
      if (progress.failedTopics[failedTopicIndex].consecutivePasses >= 3) {
        progress.failedTopics[failedTopicIndex].resolved = true;
        progress.failedTopics[failedTopicIndex].failCount = 0;
      }
    }

    // Check for streak or points badges
    const existingBadgeIds = new Set(progress.badges.map((b) => b.id));
    if (!existingBadgeIds.has("first_quiz_master") && progress.totalPoints >= 25) {
      newBadge = {
        id: "first_quiz_master",
        title: "Quick Learner",
        description: "Passed your first Company Reels™ micro-quiz!",
        icon: "zap",
      };
      progress.badges.push(newBadge);
    } else if (!existingBadgeIds.has("streak_3") && progress.currentStreak >= 3) {
      newBadge = {
        id: "streak_3",
        title: "3-Day Fire",
        description: "Completed training 3 days in a row!",
        icon: "flame",
      };
      progress.badges.push(newBadge);
    }
  } else {
    // Record or increment knowledge gap
    const failedTopicIndex = progress.failedTopics.findIndex(
      (f) => f.topic.toLowerCase() === question.topic.toLowerCase()
    );
    if (failedTopicIndex !== -1) {
      progress.failedTopics[failedTopicIndex].failCount += 1;
      progress.failedTopics[failedTopicIndex].consecutivePasses = 0;
      progress.failedTopics[failedTopicIndex].lastFailedAt = new Date();
      progress.failedTopics[failedTopicIndex].resolved = false;
    } else {
      progress.failedTopics.push({
        topic: question.topic,
        failCount: 1,
        consecutivePasses: 0,
        lastFailedAt: new Date(),
        resolved: false,
      });
    }
  }

  // Recalculate knowledge score based on total quiz attempts
  const allEvents = await UserQuizEvent.find({ userId }).select("correct").lean();
  if (allEvents.length > 0) {
    const totalCorrect = allEvents.filter((e) => e.correct).length;
    progress.knowledgeScore = Math.round((totalCorrect / allEvents.length) * 100);
  }

  await progress.save();

  // Evaluate Level 1-4 progression gates
  let progressionOutcome = null;
  try {
    const { evaluateUserProgression } = require("./certificationService");
    progressionOutcome = await evaluateUserProgression(userId);
  } catch (err) {
    console.warn("[Quiz Service] Progression check warning:", err.message);
  }

  return {
    correct: isCorrect,
    correctAnswerId: question.correctAnswerId,
    explanation: question.explanation || (isCorrect ? "Great job! That is the correct procedure." : "Please review the company standard operating procedure for this topic."),
    topic: question.topic,
    pointsAwarded,
    totalPoints: progress.totalPoints,
    currentStreak: progress.currentStreak,
    knowledgeScore: progress.knowledgeScore,
    newBadge,
    passFailConsequence: question.passFailConsequence,
    progression: progressionOutcome,
  };
}

/**
 * Retakes a previously missed question to clear a recorded knowledge gap.
 */
async function retakeQuizAnswer(userId, questionId, selectedAnswerId) {
  return submitQuizAnswer(userId, questionId, selectedAnswerId, {
    sourceReelId: null,
    responseTimeMs: 1500,
  });
}

/**
 * Returns topics and questions the employee has recently missed for self-review.
 */
async function getMissedQuestions(userId) {
  const incorrectEvents = await UserQuizEvent.find({ userId, correct: false })
    .sort({ createdAt: -1 })
    .limit(30)
    .populate("questionId")
    .populate("sourceReelId", "title duration category")
    .lean();

  const unique = [];
  const seenQuestionIds = new Set();
  for (const ev of incorrectEvents) {
    if (!ev.questionId) continue;
    const qId = String(ev.questionId._id);
    if (!seenQuestionIds.has(qId)) {
      seenQuestionIds.add(qId);
      unique.push({
        _id: ev.questionId._id,
        question: ev.questionId.question,
        topic: ev.questionId.topic,
        answerOptions: ev.questionId.answerOptions || [],
        explanation: ev.questionId.explanation,
        difficulty: ev.questionId.difficulty,
        linkedReel: ev.sourceReelId || null,
        failedAt: ev.answeredAt,
      });
    }
  }

  return unique;
}

module.exports = {
  submitQuizAnswer,
  retakeQuizAnswer,
  getMissedQuestions,
};
