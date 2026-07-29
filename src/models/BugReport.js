const mongoose = require("mongoose");

const BugReportSchema = new mongoose.Schema(
  {
    taskId: { type: mongoose.Schema.Types.ObjectId, ref: "Task", required: false },
    taskTitle: { type: String, default: "" },
    title: { type: String, required: true },
    description: { type: String, required: true },
    source: {
      panel: { type: String, default: "" },
      path: { type: String, default: "" },
    },
    attachments: [
      {
        fileName: { type: String, default: "" },
        url: { type: String, default: "" },
        mimeType: { type: String, default: "" },
        size: { type: Number, default: 0 },
        duration: { type: Number, default: 0 },
        resolution: { type: String, default: "" },
        width: { type: Number, default: 0 },
        height: { type: Number, default: 0 },
        codec: { type: String, default: "" },
        compressedSize: { type: Number, default: 0 },
        checksum: { type: String, default: "" },
        processingStatus: { type: String, default: "completed" },
      },
    ],
    status: {
      type: String,
      enum: [
        "OPEN",
        "TRIAGED",
        "IN_PROGRESS",
        "NEEDS_INFO",
        "RESOLUTION_SUBMITTED",
        "AWAITING_REPORTER_CONFIRMATION",
        "CLOSED_VERIFIED",
        "REOPENED",
        "CLOSED_ADMIN_OVERRIDE",
        "open",
        "closed",
      ],
      default: "OPEN",
    },
    severity: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "medium",
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high", "urgent"],
      default: "medium",
    },
    company: { type: String, default: "" },
    module: { type: String, default: "" },
    assignedDeveloperId: { type: String, default: "" },
    assignedDeveloperName: { type: String, default: "" },
    createdByUserId: { type: String, default: "" },
    createdByUsername: { type: String, default: "" },
    createdByRole: { type: String, default: "" },
    resolution: {
      summary: { type: String, default: "" },
      verificationPerformed: { type: String, default: "" },
      releaseVersion: { type: String, default: "" },
      deploymentEnvironment: { type: String, default: "" },
      commitUrl: { type: String, default: "" },
      pullRequestUrl: { type: String, default: "" },
      attachments: [
        {
          fileName: { type: String, default: "" },
          url: { type: String, default: "" },
          mimeType: { type: String, default: "" },
          size: { type: Number, default: 0 },
        },
      ],
      disposition: { type: String, default: "Fixed" },
      submittedBy: { type: String, default: "" },
      submittedAt: { type: Date, default: null },
    },
    verification: {
      reporterConfirmed: { type: Boolean, default: null },
      confirmedAt: { type: Date, default: null },
      feedback: { type: String, default: "" },
      rejectionReason: { type: String, default: "" },
    },
    lastActivity: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

BugReportSchema.index({ status: 1, lastActivity: -1 });
BugReportSchema.index({ severity: 1, priority: 1 });
BugReportSchema.index({ company: 1, module: 1 });
BugReportSchema.index({ createdByUsername: 1 });
BugReportSchema.index({ assignedDeveloperName: 1 });
BugReportSchema.index({ createdAt: -1 });

module.exports = mongoose.model("BugReport", BugReportSchema);
