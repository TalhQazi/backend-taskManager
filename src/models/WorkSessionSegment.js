const mongoose = require("mongoose");

/**
 * WorkSessionSegment Schema
 * Durable, server-authoritative time segment.
 * Active elapsed time is strictly:
 * sum(closedActiveSegmentDurations) + (currentActiveSegment.serverNowUtc - segmentStartedAtUtc)
 *
 * Paused, break, and blocked spans are stored explicitly and never counted toward active project time.
 */
const WorkSessionSegmentSchema = new mongoose.Schema(
  {
    workSessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WorkSession",
      default: null,
      index: true,
    },
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
      index: true,
    },
    assignmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WorkAssignment",
      default: null,
      index: true,
    },
    segmentType: {
      type: String,
      enum: ["ACTIVE", "PAUSED", "BREAK", "BLOCKED"],
      required: true,
      index: true,
    },
    startedAtUtc: {
      type: Date,
      required: true,
      index: true,
    },
    endedAtUtc: {
      type: Date,
      default: null,
      index: true,
    },
    durationSeconds: {
      type: Number,
      default: 0,
      min: 0,
    },
    reasonCode: {
      type: String,
      default: "",
    },
    reasonText: {
      type: String,
      default: "",
    },
    createdBy: { type: String, default: "" },
    createdByName: { type: String, default: "" },
    createdByRole: { type: String, default: "" },
  },
  {
    timestamps: true,
  }
);

// Indexes
WorkSessionSegmentSchema.index({ employeeId: 1, startedAtUtc: -1 });
WorkSessionSegmentSchema.index({ assignmentId: 1, segmentType: 1, startedAtUtc: -1 });
WorkSessionSegmentSchema.index({ employeeId: 1, endedAtUtc: 1 });

/**
 * Helper to compute live duration in seconds for open or closed segment
 */
WorkSessionSegmentSchema.methods.computeDuration = function (now = new Date()) {
  if (this.durationSeconds > 0 && this.endedAtUtc) {
    return this.durationSeconds;
  }
  const end = this.endedAtUtc || now;
  const startMs = new Date(this.startedAtUtc).getTime();
  const endMs = new Date(end).getTime();
  if (endMs <= startMs) return 0;
  return Math.floor((endMs - startMs) / 1000);
};

module.exports = mongoose.model("WorkSessionSegment", WorkSessionSegmentSchema);
