const mongoose = require("mongoose");
const UserReelProgress = require("../../models/UserReelProgress");
const CompanyTrainingPath = require("../../models/CompanyTrainingPath");
const Employee = require("../../models/Employee");
const EmployeeTraining = require("../../models/EmployeeTraining");

const LEVEL_DEFINITIONS = {
  1: {
    label: "New Hire",
    title: "Level 1 — New Hire Certified",
    requirements: "Complete core onboarding and safety reels with initial quiz passing.",
  },
  2: {
    label: "Trained",
    title: "Level 2 — Role Certified",
    requirements: "Complete full role training path and maintain >= 75% quiz accuracy.",
  },
  3: {
    label: "Advanced",
    title: "Level 3 — Advanced Specialist",
    requirements: "Complete advanced compliance track and sustain >= 85% quiz accuracy.",
  },
  4: {
    label: "Lead",
    title: "Level 4 — Lead / Leadership",
    requirements: "Complete leadership track with >= 90% overall knowledge retention.",
  },
};

/**
 * Automatically evaluates progression gates and awards certifications when milestones are met.
 */
async function evaluateUserProgression(userId) {
  let progress = await UserReelProgress.findOne({ userId });
  if (!progress) return null;

  const currentLevel = progress.progressionLevel || 1;
  const completedCount = (progress.completedReels || []).length;
  const knowledgeScore = progress.knowledgeScore || 100;

  let newLevel = currentLevel;

  // Level 1 -> Level 2 Gate: >= 2 completed reels and knowledgeScore >= 75%
  if (currentLevel < 2 && completedCount >= 2 && knowledgeScore >= 75) {
    newLevel = 2;
  }

  // Level 2 -> Level 3 Gate: >= 4 completed reels and knowledgeScore >= 85%
  if (currentLevel < 3 && completedCount >= 4 && knowledgeScore >= 85) {
    newLevel = 3;
  }

  // Level 3 -> Level 4 Gate: >= 5 completed reels and knowledgeScore >= 90%
  if (currentLevel < 4 && completedCount >= 5 && knowledgeScore >= 90) {
    newLevel = 4;
  }

  if (newLevel > currentLevel) {
    progress.progressionLevel = newLevel;

    // Issue certification
    const def = LEVEL_DEFINITIONS[newLevel];
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000); // 1-year compliance validity

    const newCert = {
      type: `level_${newLevel}`,
      name: def.title,
      status: "active",
      awardedAt: now,
      expiresAt,
    };

    // Check if certification exists or update
    const existingIdx = (progress.certifications || []).findIndex(
      (c) => c.type === newCert.type
    );
    if (existingIdx === -1) {
      progress.certifications.push(newCert);
    } else {
      progress.certifications[existingIdx] = newCert;
    }

    // Also award celebratory badge
    progress.badges.push({
      id: `level_${newLevel}_achievement`,
      title: `${def.label} Certified`,
      description: `Achieved ${def.title}!`,
      icon: "award",
      awardedAt: now,
    });

    await progress.save();

    // Mirror to Task Manager's core EmployeeTraining collection if employee exists
    try {
      if (mongoose.Types.ObjectId.isValid(userId)) {
        await EmployeeTraining.create({
          employeeId: userId,
          name: def.title,
          type: "certification",
          issuingAuthority: "Company Reels™ / Se7en Academy",
          issueDate: now,
          expirationDate: expiresAt,
          status: "active",
          score: `${knowledgeScore}%`,
        });
      }
    } catch (mirrorErr) {
      // Non-blocking mirror
      console.warn("[Certification] Notice: Could not mirror to EmployeeTraining:", mirrorErr.message);
    }

    return {
      leveledUp: true,
      newLevel,
      definition: def,
      certification: newCert,
    };
  }

  return { leveledUp: false, currentLevel };
}

/**
 * Returns user certifications, progression ladder, and expiration statuses.
 */
async function getUserCertifications(userId) {
  let progress = await UserReelProgress.findOne({ userId }).lean();
  const currentLevel = progress?.progressionLevel || 1;
  const now = new Date();
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

  const rawCerts = progress?.certifications || [];
  const mappedCerts = rawCerts.map((c) => {
    let status = c.status || "active";
    let daysUntilExpiry = null;

    if (c.expiresAt) {
      const exp = new Date(c.expiresAt);
      const diffMs = exp.getTime() - now.getTime();
      daysUntilExpiry = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

      if (diffMs <= 0) {
        status = "expired";
      } else if (diffMs <= thirtyDaysMs) {
        status = "expiring_soon";
      }
    }

    return {
      ...c,
      status,
      daysUntilExpiry,
    };
  });

  const nextLevel = currentLevel < 4 ? currentLevel + 1 : null;

  return {
    currentLevel,
    currentLevelDefinition: LEVEL_DEFINITIONS[currentLevel],
    nextLevel,
    nextLevelRequirements: nextLevel ? LEVEL_DEFINITIONS[nextLevel].requirements : "Maximum level achieved",
    ladder: [
      { level: 1, ...LEVEL_DEFINITIONS[1], isCurrent: currentLevel === 1, isUnlocked: currentLevel >= 1 },
      { level: 2, ...LEVEL_DEFINITIONS[2], isCurrent: currentLevel === 2, isUnlocked: currentLevel >= 2 },
      { level: 3, ...LEVEL_DEFINITIONS[3], isCurrent: currentLevel === 3, isUnlocked: currentLevel >= 3 },
      { level: 4, ...LEVEL_DEFINITIONS[4], isCurrent: currentLevel === 4, isUnlocked: currentLevel >= 4 },
    ],
    certifications: mappedCerts,
  };
}

module.exports = {
  evaluateUserProgression,
  getUserCertifications,
  LEVEL_DEFINITIONS,
};
