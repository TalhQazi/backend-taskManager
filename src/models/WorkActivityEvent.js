const mongoose = require("mongoose");
const { randomUUID } = require("crypto");

/**
 * WorkActivityEvent Schema
 * Immutable audit trail for all employee and manager workforce operations.
 * Protected against application-level update and deletion.
 */
const WorkActivityEventSchema = new mongoose.Schema(
  {
    eventId: {
      type: String,
      default: () => randomUUID(),
      required: true,
      unique: true,
      index: true,
    },
    eventType: {
      type: String,
      required: true,
      index: true,
    },
    actorUserId: {
      type: String,
      default: "",
    },
    actorName: {
      type: String,
      default: "",
    },
    actorRole: {
      type: String,
      default: "",
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
    workSessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WorkSession",
      default: null,
      index: true,
    },
    previousState: {
      type: String,
      default: null,
    },
    newState: {
      type: String,
      default: null,
    },
    previousEstimate: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    newEstimate: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    reason: {
      type: String,
      default: "",
    },
    note: {
      type: String,
      default: "",
    },
    serverTimestampUtc: {
      type: Date,
      default: Date.now,
      index: true,
    },
    requestCorrelationId: {
      type: String,
      default: "",
    },
    sourceClient: {
      type: String,
      default: "web",
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

WorkActivityEventSchema.index({ employeeId: 1, serverTimestampUtc: -1 });
WorkActivityEventSchema.index({ assignmentId: 1, serverTimestampUtc: -1 });
WorkActivityEventSchema.index({ eventType: 1, serverTimestampUtc: -1 });

// ---------------------------------------------------------------------------
// Append-only enforcement guards
// ---------------------------------------------------------------------------
const IMMUTABLE_MSG = "WorkActivityEvent is append-only: modifications and deletions are strictly forbidden.";

const BLOCKED_OPS = [
  "updateOne",
  "updateMany",
  "findOneAndUpdate",
  "findOneAndReplace",
  "replaceOne",
  "deleteOne",
  "deleteMany",
  "findOneAndDelete",
  "findOneAndRemove",
];

for (const op of BLOCKED_OPS) {
  WorkActivityEventSchema.pre(op, function (next) {
    next(new Error(IMMUTABLE_MSG));
  });
}

WorkActivityEventSchema.pre("save", function (next) {
  if (!this.isNew) return next(new Error(IMMUTABLE_MSG));
  return next();
});

WorkActivityEventSchema.pre("deleteOne", { document: true, query: false }, function (next) {
  next(new Error(IMMUTABLE_MSG));
});

module.exports = mongoose.model("WorkActivityEvent", WorkActivityEventSchema);
