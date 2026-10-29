const mongoose = require("mongoose");

const PollAudienceSchema = new mongoose.Schema(
  {
    pollId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Poll",
      required: true,
      index: true,
    },
    targetType: {
      type: String,
      enum: ["global", "company", "department", "location", "role", "user"],
      required: true,
    },
    targetId: { type: String, default: "" },
    targetLabel: { type: String, default: "" },
  },
  { timestamps: true }
);

PollAudienceSchema.index({ pollId: 1, targetType: 1 });

module.exports = mongoose.model("PollAudience", PollAudienceSchema);
