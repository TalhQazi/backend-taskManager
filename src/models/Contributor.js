const mongoose = require("mongoose");

const ContributorSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, index: true },
    email: { type: String, required: true, index: true },
    role: { type: String, enum: ["admin", "manager", "employee", "super-admin"], default: "employee" },
    avatar: { type: String, default: "" },
    department: { type: String, default: "" },
    
    // Contribution statistics
    stats: {
      totalTasksCreated: { type: Number, default: 0 },
      totalTasksUpdated: { type: Number, default: 0 },
      totalTasksCompleted: { type: Number, default: 0 },
      totalProjectsContributed: { type: Number, default: 0 },
      totalTimeSpent: { type: Number, default: 0 }, // in seconds
      lastContributionAt: { type: Date },
    },

    // Projects this contributor has worked on
    projects: [
      {
        projectId: { type: String, required: true },
        projectName: { type: String, required: true },
        firstContributionAt: { type: Date, default: Date.now },
        lastContributionAt: { type: Date, default: Date.now },
        contributionCount: { type: Number, default: 1 },
      },
    ],

    // Active status
    status: { type: String, enum: ["active", "inactive"], default: "active" },
  },
  { timestamps: true }
);

// Indexes for efficient querying
ContributorSchema.index({ "stats.totalTasksCompleted": -1 });
ContributorSchema.index({ "stats.lastContributionAt": -1 });
ContributorSchema.index({ role: 1, status: 1 });
ContributorSchema.index({ "projects.projectId": 1 });

module.exports = mongoose.model("Contributor", ContributorSchema);
