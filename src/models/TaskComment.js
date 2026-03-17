const mongoose = require("mongoose");

const TaskCommentSchema = new mongoose.Schema(
  {
    taskId: { type: mongoose.Schema.Types.ObjectId, ref: "Task", required: true, index: true },
    authorUserId: { type: String, default: "" },
    authorUsername: { type: String, default: "" },
    authorRole: { type: String, default: "" },
    message: { type: String, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("TaskComment", TaskCommentSchema);
