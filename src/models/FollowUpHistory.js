const mongoose = require("mongoose");

const FollowUpHistorySchema = new mongoose.Schema(
  {
    taskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Task",
      required: true,
      index: true,
    },
    followUpId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TaskFollowUp",
      required: true,
      index: true,
    },
    userId: {
      type: String,
      default: "system",
      index: true,
    },
    actionType: {
      type: String,
      required: true,
      index: true, // e.g. "create", "edit", "complete", "snooze", "reset", "escalate", "notify"
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
    notes: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("FollowUpHistory", FollowUpHistorySchema);
