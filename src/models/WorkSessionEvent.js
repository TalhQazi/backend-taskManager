const mongoose = require("mongoose");
const {
  WIP_EVENT_TYPE_VALUES,
  WIP_SOURCE,
  WIP_SOURCE_VALUES,
} = require("../constants/wip");

/**
 * Immutable audit log for every WIP state transition.
 *
 * APPEND-ONLY. Corrections append a new event; they never rewrite history.
 * Update/delete are blocked at the model layer by the guards below. A DB user
 * restricted to insert+find on this collection is the recommended second line
 * of defence (see the handoff notes) — the guards here stop application code,
 * not a direct driver/mongosh write.
 *
 * Events are referenced, never embedded in workSessions: an all-day session
 * with heartbeats would approach the 16MB document cap.
 */
const WorkSessionEventSchema = new mongoose.Schema(
  {
    workSessionId: { type: mongoose.Schema.Types.ObjectId, ref: "WorkSession", required: true, index: true },

    eventType: { type: String, enum: WIP_EVENT_TYPE_VALUES, required: true, index: true },

    // Free-form previous/next representation. Strings keep this schema stable
    // across status, progress, assignee and location transitions alike.
    oldValue: { type: mongoose.Schema.Types.Mixed, default: null },
    newValue: { type: mongoose.Schema.Types.Mixed, default: null },

    note: { type: String, default: "" },
    /** Arbitrary structured context (blockerId, fileUrl, reason, geo, ...). */
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },

    source: { type: String, enum: WIP_SOURCE_VALUES, default: WIP_SOURCE.WEB },

    // Actor identity, denormalized so history renders without joins.
    createdBy: { type: String, default: "" },
    createdByName: { type: String, default: "" },
    createdByRole: { type: String, default: "" },

    /**
     * Offline sync: the client's own clock at the moment of the action. The
     * server never silently rewrites it — `createdAt` is the receipt time.
     */
    clientTimestamp: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

WorkSessionEventSchema.index({ workSessionId: 1, createdAt: 1 });
WorkSessionEventSchema.index({ eventType: 1, createdAt: -1 });
// Activity feed: newest-first stream across the whole tenant.
WorkSessionEventSchema.index({ createdAt: -1 });

// ---------------------------------------------------------------------------
// Append-only enforcement.
// ---------------------------------------------------------------------------
const IMMUTABLE = "workSessionEvents is append-only: corrections must append a new event.";

const BLOCKED_QUERY_OPS = [
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

for (const op of BLOCKED_QUERY_OPS) {
  WorkSessionEventSchema.pre(op, function blockMutation(next) {
    next(new Error(IMMUTABLE));
  });
}

// Block document-level .save() on an already-persisted doc, and .remove()/.deleteOne().
WorkSessionEventSchema.pre("save", function blockResave(next) {
  if (!this.isNew) return next(new Error(IMMUTABLE));
  return next();
});

WorkSessionEventSchema.pre("deleteOne", { document: true, query: false }, function blockDocDelete(next) {
  next(new Error(IMMUTABLE));
});

// Block bulk writes that carry update/delete operations.
WorkSessionEventSchema.pre("bulkWrite", function blockBulk(next, ops) {
  const list = Array.isArray(ops) ? ops : [];
  const hasMutation = list.some((op) =>
    ["updateOne", "updateMany", "deleteOne", "deleteMany", "replaceOne"].some((k) => k in op)
  );
  if (hasMutation) return next(new Error(IMMUTABLE));
  return next();
});

module.exports = mongoose.model("WorkSessionEvent", WorkSessionEventSchema);
