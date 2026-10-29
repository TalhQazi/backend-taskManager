const mongoose = require("mongoose");
const UserReelProgress = require("../../models/UserReelProgress");
const UserQuizEvent = require("../../models/UserQuizEvent");
const UserReelEvent = require("../../models/UserReelEvent");
const Employee = require("../../models/Employee");
const CompanyReel = require("../../models/CompanyReel");

const BADGE_CATALOG = [
  {
    id: "first_step",
    title: "First Step",
    description: "Completed your first training reel.",
    tier: "bronze",
    icon: "play-circle",
  },
  {
    id: "streak_3",
    title: "On Fire 🔥",
    description: "Maintained a 3-day daily training streak.",
    tier: "bronze",
    icon: "flame",
  },
  {
    id: "streak_7",
    title: "Unstoppable ⚡",
    description: "Maintained a 7-day daily training streak.",
    tier: "silver",
    icon: "zap",
  },
  {
    id: "streak_30",
    title: "Habit of Excellence 🏆",
    description: "Maintained a 30-day daily training streak.",
    tier: "gold",
    icon: "trophy",
  },
  {
    id: "quiz_master",
    title: "Quiz Master",
    description: "Passed 5 micro-quizzes with 100% accuracy.",
    tier: "silver",
    icon: "help-circle",
  },
  {
    id: "safety_champion",
    title: "Safety Champion 🛡️",
    description: "Completed Workplace Safety & PPE training.",
    tier: "gold",
    icon: "shield-check",
  },
  {
    id: "service_star",
    title: "Service Star ⭐",
    description: "Mastered Customer Service & Escalation standards.",
    tier: "silver",
    icon: "star",
  },
  {
    id: "cyber_sentinel",
    title: "Cyber Sentinel 🔒",
    description: "Completed Cybersecurity & Device Lock protocol.",
    tier: "silver",
    icon: "lock",
  },
  {
    id: "level_2_certified",
    title: "Role Certified",
    description: "Promoted to Level 2 workforce tier.",
    tier: "silver",
    icon: "award",
  },
  {
    id: "level_3_advanced",
    title: "Advanced Specialist",
    description: "Promoted to Level 3 workforce tier.",
    tier: "gold",
    icon: "award",
  },
  {
    id: "level_4_lead",
    title: "Company Lead",
    description: "Reached the pinnacle Level 4 workforce leadership tier.",
    tier: "platinum",
    icon: "crown",
  },
];

/**
 * Records an employee learning activity, updates streak and XP, and checks badge unlocks.
 */
async function recordActivity(userId, activityType, metadata = {}) {
  let progress = await UserReelProgress.findOne({ userId });
  if (!progress) {
    progress = await UserReelProgress.create({
      userId,
      completedReels: [],
      currentStreak: 0,
      longestStreak: 0,
      knowledgeScore: 100,
      totalPoints: 0,
      badges: [],
    });
  }

  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];
  const lastActiveStr = progress.lastActiveDate
    ? new Date(progress.lastActiveDate).toISOString().split("T")[0]
    : null;

  let streakUpdated = false;
  let newBadgesUnlocked = [];

  // Streak Calculation
  if (lastActiveStr !== todayStr) {
    if (lastActiveStr) {
      const lastActiveTime = new Date(progress.lastActiveDate).getTime();
      const diffDays = Math.floor((now.getTime() - lastActiveTime) / (1000 * 60 * 60 * 24));

      if (diffDays === 1) {
        // Consecutive day
        progress.currentStreak += 1;
      } else if (diffDays > 1) {
        // Streak broken
        progress.currentStreak = 1;
      }
    } else {
      progress.currentStreak = 1;
    }

    if (progress.currentStreak > (progress.longestStreak || 0)) {
      progress.longestStreak = progress.currentStreak;
    }

    progress.lastActiveDate = now;
    streakUpdated = true;

    // Streak Milestone Bonuses
    if (progress.currentStreak === 3) {
      progress.totalPoints += 50;
      await unlockBadge(progress, "streak_3", newBadgesUnlocked);
    } else if (progress.currentStreak === 7) {
      progress.totalPoints += 100;
      await unlockBadge(progress, "streak_7", newBadgesUnlocked);
    } else if (progress.currentStreak === 30) {
      progress.totalPoints += 300;
      await unlockBadge(progress, "streak_30", newBadgesUnlocked);
    }
  }

  // Activity-specific XP & Badges
  if (activityType === "reel_completed") {
    progress.totalPoints += 10;
    await unlockBadge(progress, "first_step", newBadgesUnlocked);

    // Check content topic badges
    if (metadata.category === "safety" || (metadata.title && metadata.title.toLowerCase().includes("safety"))) {
      await unlockBadge(progress, "safety_champion", newBadgesUnlocked);
    }
    if (metadata.category === "operations" || (metadata.title && metadata.title.toLowerCase().includes("customer"))) {
      await unlockBadge(progress, "service_star", newBadgesUnlocked);
    }
    if (metadata.category === "compliance" || (metadata.title && metadata.title.toLowerCase().includes("cyber"))) {
      await unlockBadge(progress, "cyber_sentinel", newBadgesUnlocked);
    }
  } else if (activityType === "quiz_passed") {
    // Check Quiz Master (5+ passed quizzes)
    const passedCount = await UserQuizEvent.countDocuments({ userId, correct: true });
    if (passedCount >= 5) {
      await unlockBadge(progress, "quiz_master", newBadgesUnlocked);
    }
  }

  await progress.save();

  return {
    currentStreak: progress.currentStreak,
    longestStreak: progress.longestStreak,
    totalPoints: progress.totalPoints,
    streakUpdated,
    newBadges: newBadgesUnlocked,
  };
}

async function unlockBadge(progress, badgeId, newBadgesList) {
  const existing = (progress.badges || []).some((b) => b.id === badgeId);
  if (!existing) {
    const badgeDef = BADGE_CATALOG.find((b) => b.id === badgeId);
    if (badgeDef) {
      const badgeObj = {
        id: badgeDef.id,
        title: badgeDef.title,
        description: badgeDef.description,
        icon: badgeDef.icon,
        awardedAt: new Date(),
      };
      progress.badges.push(badgeObj);
      newBadgesList.push(badgeObj);
    }
  }
}

/**
 * Returns full gamification profile with milestones, streak records, and badge showcase.
 */
async function getEmployeeProfile(userId) {
  let progress = await UserReelProgress.findOne({ userId }).lean();
  let employee = null;
  if (mongoose.Types.ObjectId.isValid(userId)) {
    employee = await Employee.findById(userId).lean();
  }

  const [totalWatched, totalQuizzesPassed] = await Promise.all([
    UserReelEvent.countDocuments({ userId, eventType: "complete" }),
    UserQuizEvent.countDocuments({ userId, correct: true }),
  ]);

  const earnedBadgeIds = new Set((progress?.badges || []).map((b) => b.id));
  const badgesShowcase = BADGE_CATALOG.map((b) => {
    const isUnlocked = earnedBadgeIds.has(b.id);
    const earned = (progress?.badges || []).find((eb) => eb.id === b.id);
    return {
      ...b,
      isUnlocked,
      awardedAt: earned ? earned.awardedAt : null,
    };
  });

  // Milestone Detection (Birthday & Work Anniversary)
  const now = new Date();
  const todayMonth = now.getMonth();
  const todayDate = now.getDate();

  let milestoneCelebration = null;

  if (employee?.hireDate) {
    const hire = new Date(employee.hireDate);
    if (hire.getMonth() === todayMonth && hire.getDate() === todayDate) {
      const years = now.getFullYear() - hire.getFullYear();
      if (years > 0) {
        milestoneCelebration = {
          type: "work_anniversary",
          title: `Happy ${years}${getOrdinalSuffix(years)} Work Anniversary! 🎊`,
          message: `Thank you for ${years} remarkable year${years > 1 ? "s" : ""} of dedication to the Se7en standard.`,
        };
      }
    }
  }

  if (!milestoneCelebration && (employee?.dob || employee?.birthday)) {
    const birth = new Date(employee.dob || employee.birthday);
    if (birth.getMonth() === todayMonth && birth.getDate() === todayDate) {
      milestoneCelebration = {
        type: "birthday",
        title: "Happy Birthday! 🎂",
        message: "The entire team wishes you an extraordinary birthday today!",
      };
    }
  }

  return {
    employee: {
      _id: userId,
      name: employee ? `${employee.firstName || ""} ${employee.lastName || ""}`.trim() || employee.name : "Team Member",
      role: employee?.role || employee?.userRole || "Employee",
      department: employee?.department || "Operations",
      profilePicture: employee?.profilePicture || null,
    },
    progressionLevel: progress?.progressionLevel || 1,
    currentStreak: progress?.currentStreak || 0,
    longestStreak: progress?.longestStreak || 0,
    totalPoints: progress?.totalPoints || 0,
    knowledgeScore: progress?.knowledgeScore || 100,
    totalWatched,
    totalQuizzesPassed,
    badges: badgesShowcase,
    unlockedBadgesCount: (progress?.badges || []).length,
    totalBadgesCount: BADGE_CATALOG.length,
    milestoneCelebration,
  };
}

/**
 * Returns team leaderboard ranked by Points, Streaks, and Knowledge Retention.
 */
async function getTeamLeaderboard(currentUserId, filter = "all") {
  let employee = null;
  if (mongoose.Types.ObjectId.isValid(currentUserId)) {
    employee = await Employee.findById(currentUserId).lean();
  }
  const userDept = employee?.department;

  const topProgress = await UserReelProgress.find()
    .sort({ totalPoints: -1, knowledgeScore: -1 })
    .limit(50)
    .populate("userId", "firstName lastName name role department profilePicture")
    .lean();

  let rank = 1;
  const leaderboard = topProgress.map((p) => {
    const emp = p.userId || {};
    const name = `${emp.firstName || ""} ${emp.lastName || ""}`.trim() || emp.name || "Employee";
    const isCurrentUser = String(emp._id || p.userId) === String(currentUserId);

    return {
      rank: rank++,
      userId: emp._id || p.userId,
      name,
      role: emp.role || "Team Member",
      department: emp.department || "General",
      profilePicture: emp.profilePicture || null,
      totalPoints: p.totalPoints || 0,
      currentStreak: p.currentStreak || 0,
      knowledgeScore: p.knowledgeScore || 100,
      level: p.progressionLevel || 1,
      isCurrentUser,
    };
  });

  if (filter === "department" && userDept) {
    return leaderboard.filter((item) => item.department?.toLowerCase() === userDept.toLowerCase());
  }

  return leaderboard;
}

function getOrdinalSuffix(i) {
  const j = i % 10,
    k = i % 100;
  if (j === 1 && k !== 11) return "st";
  if (j === 2 && k !== 12) return "nd";
  if (j === 3 && k !== 13) return "rd";
  return "th";
}

module.exports = {
  recordActivity,
  getEmployeeProfile,
  getTeamLeaderboard,
  BADGE_CATALOG,
};
