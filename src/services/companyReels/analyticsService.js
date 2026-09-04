const CompanyReel = require("../../models/CompanyReel");
const UserReelEvent = require("../../models/UserReelEvent");
const UserQuizEvent = require("../../models/UserQuizEvent");
const UserReelProgress = require("../../models/UserReelProgress");
const Employee = require("../../models/Employee");

/**
 * Analytics and risk detection service for managers and administrators.
 */
async function getAdminAnalytics(filter = {}) {
  const [
    totalReels,
    mandatoryReels,
    totalEmployees,
    allProgress,
    recentEvents,
    allQuizEvents,
  ] = await Promise.all([
    CompanyReel.countDocuments({ status: "published" }),
    CompanyReel.countDocuments({ status: "published", isMandatory: true }),
    Employee.countDocuments({ status: "active" }),
    UserReelProgress.find().lean(),
    UserReelEvent.find().sort({ createdAt: -1 }).limit(500).lean(),
    UserQuizEvent.find().sort({ createdAt: -1 }).limit(500).lean(),
  ]);

  // Total completions
  const totalCompletions = recentEvents.filter((e) => e.completed).length;

  // Average quiz accuracy
  const totalQuizzes = allQuizEvents.length;
  const correctQuizzes = allQuizEvents.filter((q) => q.correct).length;
  const overallAccuracy = totalQuizzes > 0 ? Math.round((correctQuizzes / totalQuizzes) * 100) : 100;

  // Identify High-Risk Items:
  // 1. Unresolved repeated failures (failed >= 2 times on a topic)
  const riskKnowledgeGaps = [];
  for (const prog of allProgress) {
    for (const f of prog.failedTopics || []) {
      if (!f.resolved && f.failCount >= 2) {
        riskKnowledgeGaps.push({
          userId: prog.userId,
          topic: f.topic,
          failCount: f.failCount,
          lastFailedAt: f.lastFailedAt,
        });
      }
    }
  }

  // 2. Overdue Mandatory Training
  const now = new Date();
  const overdueReels = await CompanyReel.find({
    status: "published",
    isMandatory: true,
    dueDate: { $lt: now },
  }).select("title category dueDate").lean();

  return {
    overview: {
      totalReels,
      mandatoryReels,
      activeEmployees: totalEmployees,
      totalCompletionsRecorded: totalCompletions,
      averageQuizAccuracy: overallAccuracy,
    },
    riskHighlights: {
      repeatedQuizFailures: riskKnowledgeGaps.length,
      overdueMandatoryReels: overdueReels.length,
      overdueList: overdueReels,
      knowledgeGaps: riskKnowledgeGaps.slice(0, 10),
    },
  };
}

module.exports = {
  getAdminAnalytics,
};
