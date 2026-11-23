const mongoose = require("mongoose");

const PollVoteSchema = new mongoose.Schema(
  {
    pollId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Poll",
      required: true,
      index: true,
    },
    userId: { type: String, required: true, index: true },
    userName: { type: String, default: "" },
    optionIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "PollOption" }],
    rating: { type: Number, default: null },
    textAnswer: { type: String, default: "" },
    previousVote: {
      optionIds: [{ type: mongoose.Schema.Types.ObjectId }],
      rating: { type: Number, default: null },
      textAnswer: { type: String, default: "" },
      changedAt: { type: Date },
    },
  },
  { timestamps: true }
);

PollVoteSchema.index({ pollId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model("PollVote", PollVoteSchema);
