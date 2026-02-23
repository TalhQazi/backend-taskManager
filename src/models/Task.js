const mongoose = require("mongoose");

const TaskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String, default: "" },
    assignee: { type: String, default: "" },
    location: { type: String, default: "" },
    priority: { type: String, enum: ["high", "medium", "low"], default: "medium" },
    status: { type: String, enum: ["active", "pending", "completed"], default: "pending" },
    dueDate: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Task", TaskSchema);
