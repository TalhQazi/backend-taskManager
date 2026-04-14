const mongoose = require("mongoose");

const TaskCommentSchema = new mongoose.Schema(
  {
    taskId: { type: mongoose.Schema.Types.ObjectId, ref: "Task", required: true, index: true },
    authorUserId: { type: String, default: "" },
    authorUsername: { type: String, default: "" },
    authorRole: { type: String, default: "" },
    message: { type: String, default: "" },
    attachments: [
      {
        fileName: { type: String, default: "" },
        url: { type: String, default: "" },
        mimeType: { type: String, default: "" },
        size: { type: Number, default: 0 },
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

// Compound index for listing comments by task in order
TaskCommentSchema.index({ taskId: 1, createdAt: 1 });

module.exports = mongoose.model("TaskComment", TaskCommentSchema);
