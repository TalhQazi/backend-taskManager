const mongoose = require("mongoose");
const {
  WIP_STATUS,
  WIP_STATUS_VALUES,
  WIP_DEVICE_TYPE,
  WIP_DEVICE_TYPE_VALUES,
} = require("../constants/wip");

/**
 * A single unit of tracked work: one employee, one task, one continuous span.
 *
 * Time truth: `startedAt` + the append-only event log are authoritative.
 * `elapsedSeconds` is a denormalized cache refreshed on write/heartbeat — never
 * trust it for billing; recompute with lib/wipElapsed.js.
 *
 * `endedAt` is ALWAYS written (null while active) so the partial unique index
 * below matches reliably — a missing field would not be caught by it.
 */
const WorkSessionSchema = new mongoose.Schema(
  {
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true, index: true },
    // Denormalized for grid rendering without an N+1 lookup.
    employeeName: { type: String, default: "" },
    department: { type: String, default: "", index: true },

    taskId: { type: mongoose.Schema.Types.ObjectId, ref: "Task", required: true, index: true },
    taskTitle: { type: String, default: "" },

    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", default: null, index: true },
    projectName: { type: String, default: "" },

    status: { type: String, enum: WIP_STATUS_VALUES, default: WIP_STATUS.WORKING, required: true },

    startedAt: { type: Date, required: true },
    // null while running. Never edited after being set — corrections append events.
    endedAt: { type: Date, default: null },
    // Set while the clock is stopped (paused/break); cleared on resume.
    pausedAt: { type: Date, default: null },
    pausedTotalSeconds: { type: Number, default: 0, min: 0 },

    // Cache only. Recomputed from startedAt/pausedTotalSeconds — see wipElapsed.
    elapsedSeconds: { type: Number, default: 0, min: 0 },
    progressPercent: { type: Number, default: 0, min: 0, max: 100 },

    // Phase 3 — rate captured at start, never recomputed (a raise must not reprice history).
    laborRateSnapshotCents: { type: Number, default: null },
    laborCostCents: { type: Number, default: 0, min: 0 },

    // Phase 4 — location. GPS is opt-in; null means "not consented / unavailable".
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: "WorkLocation", default: null },
    locationName: { type: String, default: "" },
    latitude: { type: Number, default: null },
    longitude: { type: Number, default: null },

    deviceType: { type: String, enum: WIP_DEVICE_TYPE_VALUES, default: WIP_DEVICE_TYPE.UNKNOWN },
    lastActivityAt: { type: Date, default: Date.now, index: true },

    // Open blocker pointer — keeps the grid query single-collection.
    activeBlockerId: { type: mongoose.Schema.Types.ObjectId, ref: "Blocker", default: null },

    // Set when a manager force-stops. startedAt is never touched.
    forceStoppedBy: { type: String, default: "" },
    forceStopReason: { type: String, default: "" },

    createdBy: { type: String, default: "" },
    updatedBy: { type: String, default: "" },
  },
  { timestamps: true }
);

// --- Indexes (mirror the brief) --------------------------------------------
WorkSessionSchema.index({ employeeId: 1, status: 1, startedAt: -1 });
WorkSessionSchema.index({ projectId: 1, status: 1 });
WorkSessionSchema.index({ status: 1, startedAt: -1 });
WorkSessionSchema.index({ lastActivityAt: -1 });
WorkSessionSchema.index({ department: 1, status: 1, startedAt: -1 });

/**
 * One active session per employee. `endedAt: null` only matches documents that
 * explicitly store null — the schema default guarantees that.
 */
WorkSessionSchema.index(
  { employeeId: 1 },
  { unique: true, partialFilterExpression: { endedAt: null }, name: "uniq_active_session_per_employee" }
);

/** True when the production clock is currently stopped. */
WorkSessionSchema.methods.isPaused = function isPaused() {
  return this.pausedAt != null && this.endedAt == null;
};

module.exports = mongoose.model("WorkSession", WorkSessionSchema);
