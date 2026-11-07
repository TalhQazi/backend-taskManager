const mongoose = require("mongoose");

const PollDecisionSchema = new mongoose.Schema(
  {
    pollId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Poll",
      required: true,
      index: true,
    },
    decision: {
      type: String,
      enum: ["implemented", "rejected", "deferred"],
      required: true,
    },
    notes: { type: String, default: "" },
    decidedById: { type: String, default: "" },
    decidedByName: { type: String, default: "" },
    decidedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

PollDecisionSchema.index({ pollId: 1, decidedAt: -1 });

module.exports = mongoose.model("PollDecision", PollDecisionSchema);
