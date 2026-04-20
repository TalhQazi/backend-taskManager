const mongoose = require("mongoose");

const TaskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, index: true },
    description: { type: String, default: "" },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: false, index: true },
    assignees: { type: [String], default: [], index: true },
    priority: { type: String, enum: ["high", "medium", "low"], default: "medium", index: true },
    status: { type: String, enum: ["pending", "in-progress", "completed", "overdue"], default: "pending", index: true },
    category: { type: String, enum: ["task", "bug", "feature", "maintenance"], default: "task", index: true },
    dueDate: { type: Date, index: true },
    dueTime: { type: String, default: "" },
    createdAt: { type: String, default: "", index: true },
    attachmentFileName: { type: String, default: "" },
    attachmentNote: { type: String, default: "" },
    attachment: {
      fileName: { type: String, default: "" },
      url: { type: String, default: "" },
      mimeType: { type: String, default: "" },
      size: { type: Number, default: 0 },
    },
    attachments: [
      {
        fileName: { type: String, default: "" },
        url: { type: String, default: "" },
        mimeType: { type: String, default: "" },
        size: { type: Number, default: 0 },
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
    startedAt: { type: Date },
    totalTimeSpent: { type: Number, default: 0 }, // cumulative time in seconds
    
    // Contributor tracking
    createdBy: {
      userId: { type: String, default: "" },
      name: { type: String, default: "" },
      email: { type: String, default: "" },
      role: { type: String, default: "" },
    },
    contributors: [
      {
        userId: { type: String, required: true },
        name: { type: String, required: true },
        email: { type: String },
        role: { type: String },
        addedAt: { type: Date, default: Date.now },
        contributionType: { type: String, enum: ["creator", "assignee", "updater", "reviewer"], default: "assignee" },
        actions: [String], // e.g., ["created", "updated_status", "added_comment"]
      },
    ],
    contributionHistory: [
      {
        userId: { type: String, required: true },
        name: { type: String, required: true },
        action: { type: String, required: true }, // e.g., "created", "updated", "completed"
        timestamp: { type: Date, default: Date.now },
        details: { type: String, default: "" },
      },
    ],
  },
  { timestamps: true }
);

// Compound indexes for common query patterns
TaskSchema.index({ projectId: 1, status: 1 });
TaskSchema.index({ assignees: 1, status: 1 });
TaskSchema.index({ createdAt: -1, status: 1 });
TaskSchema.index({ projectId: 1, createdAt: -1 });
// Text index for search queries (replaces regex scans)
TaskSchema.index({ title: "text", description: "text" });

module.exports = mongoose.model("Task", TaskSchema);
