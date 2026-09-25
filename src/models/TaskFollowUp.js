const mongoose = require("mongoose");

const TaskFollowUpSchema = new mongoose.Schema(
  {
    taskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Task",
      required: true,
      index: true,
    },
    createdBy: {
      type: String,
      default: "system",
    },
    dueAt: {
      type: Date,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["active", "completed", "overdue", "snoozed"],
      default: "active",
      index: true,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    snoozedUntil: {
      type: Date,
      default: null,
    },
    escalationLevel: {
      type: Number,
      default: 1,
    },
    escalationHistory: [
      {
        level: { type: Number, required: true },
        triggeredAt: { type: Date, default: Date.now },
        notifiedUsers: { type: [String], default: [] },
      },
    ],
    slaStatus: {
      type: String,
      enum: ["On Track", "Warning", "Breached", "Resolved Late", "Resolved On Time"],
      default: "On Track",
      index: true,
    },
    slaResponseTime: {
      type: Number, // threshold in minutes
      default: 15,
    },
    slaFollowUpInterval: {
      type: Number, // threshold in minutes
      default: 30,
    },
    slaCompletionDeadline: {
      type: Number, // threshold in minutes
      default: 60,
    },
    aiSuggestions: {
      suggestedInterval: { type: Number, default: 30 },
      riskScore: { type: Number, default: 0 }, // 0 to 100
      recommendedEscalation: { type: Number, default: 15 },
      suggestedAssignee: { type: String, default: "" },
      recommendedNextAction: { type: String, default: "" },
    },
  },
  { timestamps: true }
);

// High-performance compound query index
TaskFollowUpSchema.index({ taskId: 1, status: 1 });
TaskFollowUpSchema.index({ dueAt: 1, status: 1 });

module.exports = mongoose.model("TaskFollowUp", TaskFollowUpSchema);
