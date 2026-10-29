const mongoose = require("mongoose");

/**
 * Directed dependency edge between two existing Task records (Gantt/Timeline).
 * A separate edge table — existing Task documents are never modified.
 * type: FS (finish→start), SS, FF, SF. lagDays shifts the successor.
 */
const TaskDependencySchema = new mongoose.Schema(
  {
    predecessorId: { type: mongoose.Schema.Types.ObjectId, ref: "Task", required: true, index: true },
    successorId: { type: mongoose.Schema.Types.ObjectId, ref: "Task", required: true, index: true },
    type: { type: String, enum: ["FS", "SS", "FF", "SF"], default: "FS" },
    lagDays: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

// No self-loops / duplicate edges.
TaskDependencySchema.index({ predecessorId: 1, successorId: 1, type: 1 }, { unique: true });

module.exports = mongoose.models.TaskDependency || mongoose.model("TaskDependency", TaskDependencySchema);
