const mongoose = require("mongoose");

const PollCommentSchema = new mongoose.Schema(
  {
    pollId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Poll",
      required: true,
      index: true,
    },
    userId: { type: String, required: true, index: true },
    userName: { type: String, default: "" },
    body: { type: String, required: true, trim: true },
    attachments: [
      {
        fileName: { type: String, default: "" },
        url: { type: String, default: "" },
        mimeType: { type: String, default: "" },
        size: { type: Number, default: 0 },
      },
    ],
  },
  { timestamps: true }
);

PollCommentSchema.index({ pollId: 1, createdAt: -1 });

module.exports = mongoose.model("PollComment", PollCommentSchema);
