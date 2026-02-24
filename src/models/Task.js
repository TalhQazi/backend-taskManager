const mongoose = require("mongoose");

const TaskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String, default: "" },
    assignee: { type: String, default: "" },
    assigneeInitials: { type: String, default: "" },
    location: { type: String, default: "" },
    priority: { type: String, enum: ["high", "medium", "low"], default: "medium" },
    status: { type: String, enum: ["pending", "in-progress", "completed", "overdue"], default: "pending" },
    dueDate: { type: Date },
    dueTime: { type: String, default: "" },
    createdAt: { type: String, default: "" },
    attachmentFileName: { type: String, default: "" },
    attachmentNote: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Task", TaskSchema);
