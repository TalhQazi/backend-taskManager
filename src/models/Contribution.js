const mongoose = require("mongoose");

const ContributionSchema = new mongoose.Schema(
  {
    // Who made the contribution
    contributorId: { type: String, required: true, index: true },
    contributorName: { type: String, required: true, index: true },
    contributorEmail: { type: String, required: true },
    contributorRole: { type: String, required: true },

    // What was the contribution
    action: {
      type: String,
      required: true,
      enum: [
        "task_created",
        "task_updated",
        "task_status_changed",
        "task_assigned",
        "task_completed",
        "task_comment_added",
        "task_attachment_added",
        "task_time_logged",
        "code_committed",
        "review_completed",
        "project_joined",
      ],
      index: true,
    },

    // Where was the contribution made
    resourceType: {
      type: String,
      required: true,
      enum: ["task", "project", "module", "code"],
      index: true,
    },
    resourceId: { type: String, required: true, index: true },
    resourceName: { type: String, required: true },

    // Project context (if applicable)
    projectId: { type: String, index: true },
    projectName: { type: String },

    // Detailed information
    description: { type: String, required: true },
    
    // Changes made (for updates)
    changes: [
      {
        field: { type: String },
        oldValue: { type: mongoose.Schema.Types.Mixed },
        newValue: { type: mongoose.Schema.Types.Mixed },
      },
    ],

    // Time spent (in seconds)
    timeSpent: { type: Number, default: 0 },

    // Metadata
    metadata: {
      ipAddress: { type: String, default: "" },
      userAgent: { type: String, default: "" },
      source: { type: String, default: "web" }, // web, mobile, api, git
      moduleName: { type: String, default: "" }, // for code-level tracking
      fileName: { type: String, default: "" },
      commitHash: { type: String, default: "" },
    },

    // For ranking/filtering
    impact: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "medium",
    },
  },
  { timestamps: true }
);

// Compound indexes for common query patterns
ContributionSchema.index({ contributorId: 1, createdAt: -1 });
ContributionSchema.index({ resourceType: 1, resourceId: 1, createdAt: -1 });
ContributionSchema.index({ projectId: 1, createdAt: -1 });
ContributionSchema.index({ action: 1, createdAt: -1 });
ContributionSchema.index({ createdAt: -1 });

module.exports = mongoose.model("Contribution", ContributionSchema);
