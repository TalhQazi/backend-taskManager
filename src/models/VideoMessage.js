const mongoose = require("mongoose");

const VideoMessageSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: [
        "birthday",
        "30d",
        "90d",
        "6m",
        "1y",
        "2y",
        "3y",
        "4y",
        "5y",
        "6y",
        "7y",
        "8y",
        "9y",
        "10y",
        "annual",
        "top-performer",
      ],
      required: true,
      index: true,
    },
    title: { type: String, required: true },
    subtitle: { type: String, default: "" },
    videoUrl: { type: String, required: true },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

VideoMessageSchema.index({ type: 1, isActive: 1 });

module.exports = mongoose.model("VideoMessage", VideoMessageSchema);
