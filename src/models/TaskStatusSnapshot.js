const mongoose = require("mongoose");
const { WIP_STATUS_VALUES } = require("../constants/wip");

/**
 * Periodic rollup of a session's state, written on heartbeat.
 *
 * Feeds analytics (heat maps, idle patterns, productivity) so those never scan
 * the raw workSessionEvents log. Safe to TTL-expire; it is derived data.
 */
const TaskStatusSnapshotSchema = new mongoose.Schema(
  {
    workSessionId: { type: mongoose.Schema.Types.ObjectId, ref: "WorkSession", required: true, index: true },
    taskId: { type: mongoose.Schema.Types.ObjectId, ref: "Task", required: true },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", default: null },
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true, index: true },
    department: { type: String, default: "" },

    status: { type: String, enum: WIP_STATUS_VALUES, required: true },
    elapsedSeconds: { type: Number, default: 0 },
    progressPercent: { type: Number, default: 0 },
    laborCostCents: { type: Number, default: 0 },
    idleSeconds: { type: Number, default: 0 },

    /** Bucket keys for cheap heat-map grouping. UTC. */
    hourOfDay: { type: Number, min: 0, max: 23 },
    dayOfWeek: { type: Number, min: 1, max: 7 },

    capturedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false }
);

TaskStatusSnapshotSchema.index({ capturedAt: -1 });
TaskStatusSnapshotSchema.index({ department: 1, capturedAt: -1 });
TaskStatusSnapshotSchema.index({ employeeId: 1, capturedAt: -1 });
TaskStatusSnapshotSchema.index({ dayOfWeek: 1, hourOfDay: 1 });

module.exports = mongoose.model("TaskStatusSnapshot", TaskStatusSnapshotSchema);
