const mongoose = require("mongoose");

/**
 * WorkAssignment Schema
 * Represents an explicit project or task assignment given to an employee,
 * with queue position, expected duration/completion, progress, and lifecycle status.
 */
const WorkAssignmentSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
      index: true,
    },
    employeeName: { type: String, default: "" },
    department: { type: String, default: "", index: true },

    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      default: null,
      index: true,
    },
    projectName: { type: String, default: "" },

    taskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Task",
      default: null,
      index: true,
    },
    taskTitle: { type: String, default: "" },
    subtaskTitle: { type: String, default: "" },

    status: {
      type: String,
      enum: [
        "ASSIGNED",
        "ACTIVE",
        "PAUSED",
        "BREAK",
        "BLOCKED",
        "REVIEW",
        "AVAILABLE",
        "OFFLINE",
        "COMPLETED",
        "CANCELLED",
      ],
      default: "ASSIGNED",
      required: true,
      index: true,
    },

    priority: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "medium",
      index: true,
    },

    progressPercent: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },

    progressSource: {
      type: String,
      enum: ["MANUAL", "TASK_WEIGHTED", "MILESTONE", "TIME_RATIO", "EXTERNAL"],
      default: "MANUAL",
    },

    // Expected duration in seconds
    expectedActiveSeconds: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Deterministic or explicit expected completion datetime in UTC
    expectedCompletionAt: {
      type: Date,
      default: null,
      index: true,
    },

    plannedStartAt: {
      type: Date,
      default: null,
    },

    actualStartedAt: {
      type: Date,
      default: null,
    },

    actualCompletedAt: {
      type: Date,
      default: null,
    },

    // Position in queue (0 = currently active assignment, 1 = next assignment, etc.)
    queuePosition: {
      type: Number,
      default: 0,
      index: true,
    },

    // Blocker / pause reasons
    blockedReason: { type: String, default: "" },
    blockedAt: { type: Date, default: null },
    pausedReason: { type: String, default: "" },
    pausedAt: { type: Date, default: null },

    // Tracking estimate modifications
    estimateVersion: {
      type: Number,
      default: 1,
    },

    // Concurrency control
    optimisticConcurrencyVersion: {
      type: Number,
      default: 1,
    },

    notes: { type: String, default: "" },

    createdBy: { type: String, default: "" },
    createdByName: { type: String, default: "" },
    createdByRole: { type: String, default: "" },
  },
  { timestamps: true }
);

// Compound indexes for rapid lookup and workforce queries
WorkAssignmentSchema.index({ employeeId: 1, status: 1, queuePosition: 1 });
WorkAssignmentSchema.index({ employeeId: 1, queuePosition: 1 });
WorkAssignmentSchema.index({ projectId: 1, status: 1 });
WorkAssignmentSchema.index({ status: 1, expectedCompletionAt: 1 });
WorkAssignmentSchema.index({ department: 1, status: 1 });

module.exports = mongoose.model("WorkAssignment", WorkAssignmentSchema);
