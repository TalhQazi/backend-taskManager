const mongoose = require("mongoose");
const { BLOCKER_CATEGORY_VALUES, BLOCKER_SEVERITY_VALUES } = require("../constants/wip");

/** Why work stopped, who owns unblocking it, and when it cleared. */
const BlockerSchema = new mongoose.Schema(
  {
    taskId: { type: mongoose.Schema.Types.ObjectId, ref: "Task", required: true, index: true },
    workSessionId: { type: mongoose.Schema.Types.ObjectId, ref: "WorkSession", default: null, index: true },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", default: null },
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", default: null },

    reason: { type: String, required: true, trim: true },
    category: { type: String, enum: BLOCKER_CATEGORY_VALUES, required: true },
    /** Free-text party responsible for unblocking (vendor name, customer, dept). */
    blockedOn: { type: String, default: "" },
    severity: { type: String, enum: BLOCKER_SEVERITY_VALUES, default: "medium" },

    createdBy: { type: String, default: "" },
    createdByName: { type: String, default: "" },

    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: String, default: "" },
    resolutionNote: { type: String, default: "" },
  },
  { timestamps: true }
);

BlockerSchema.index({ taskId: 1, resolvedAt: 1 });
BlockerSchema.index({ resolvedAt: 1, severity: -1 });
BlockerSchema.index({ createdAt: -1 });

module.exports = mongoose.model("Blocker", BlockerSchema);
