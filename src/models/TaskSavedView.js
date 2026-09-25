const mongoose = require("mongoose");

/**
 * A named, reusable preset of filters/sort/columns for the task workspace
 * ("My overdue", "Team Kanban"). Per-user; optionally shared org-wide.
 * Purely presentation metadata — never touches task records.
 */
const TaskSavedViewSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true },
    viewType: {
      type: String,
      enum: ["card", "list", "compact", "kanban", "workload", "calendar", "timeline", "wip", "executive"],
      default: "card",
    },
    filters: { type: mongoose.Schema.Types.Mixed, default: {} }, // { status, priority, assignment, search, projectId }
    sort: { type: String, default: "" },
    columns: { type: [String], default: [] }, // list/compact column selection
    isShared: { type: Boolean, default: false },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true }
);

TaskSavedViewSchema.index({ userId: 1, name: 1 }, { unique: true });

module.exports = mongoose.models.TaskSavedView || mongoose.model("TaskSavedView", TaskSavedViewSchema);
