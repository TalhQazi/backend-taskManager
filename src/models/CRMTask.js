const mongoose = require("mongoose");

const crmTaskSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ["Follow-up Call", "Meeting", "Reminder"],
      required: true,
    },
    assignedTo: {
      type: String,
      default: "Unassigned",
      trim: true,
    },
    dueDate: {
      type: Date,
      required: true,
    },
    priority: {
      type: String,
      enum: ["Low", "Medium", "High", "Urgent"],
      default: "Medium",
    },
    linkedEntity: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: ["Pending", "Completed"],
      default: "Pending",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for faster queries
crmTaskSchema.index({ status: 1 });
crmTaskSchema.index({ priority: 1 });
crmTaskSchema.index({ type: 1 });
crmTaskSchema.index({ assignedTo: 1 });
crmTaskSchema.index({ dueDate: 1 });

module.exports = mongoose.model("CRMTask", crmTaskSchema);
