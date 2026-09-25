const mongoose = require("mongoose");

const PollOptionSchema = new mongoose.Schema(
  {
    pollId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Poll",
      required: true,
      index: true,
    },
    label: { type: String, required: true, trim: true },
    imageUrl: { type: String, default: "" },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

PollOptionSchema.index({ pollId: 1, sortOrder: 1 });

module.exports = mongoose.model("PollOption", PollOptionSchema);
