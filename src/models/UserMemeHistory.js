const mongoose = require("mongoose");

const UserMemeHistorySchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    memeId: { type: mongoose.Schema.Types.ObjectId, ref: "Meme", required: true, index: true },
    viewedAt: { type: Date, required: true, index: true },
    // Useful for debugging multi-device or retries
    clientTimestamp: { type: Date, default: null },
  },
  { timestamps: true }
);

UserMemeHistorySchema.index({ userId: 1, viewedAt: -1 });
UserMemeHistorySchema.index({ userId: 1, memeId: 1, viewedAt: -1 });

module.exports = mongoose.model("UserMemeHistory", UserMemeHistorySchema);