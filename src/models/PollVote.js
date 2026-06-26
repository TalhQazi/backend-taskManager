const mongoose = require("mongoose");

const PollVoteSchema = new mongoose.Schema(
  {
    pollId: { type: mongoose.Schema.Types.ObjectId, ref: "Poll", required: true, index: true },
    userId: { type: String, required: true, index: true },
    userName: { type: String, required: true },
    userDepartment: { type: String, required: true },
    userLocation: { type: String, required: true },
    optionId: { type: String, default: null },
    ratingValue: { type: Number, default: null },
    rankedOrder: { type: [String], default: [] },
    votedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

// Enforce one vote per user per poll
PollVoteSchema.index({ pollId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model("PollVote", PollVoteSchema);
