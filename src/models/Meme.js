const mongoose = require("mongoose");

const MemeSchema = new mongoose.Schema(
  {
    imageUrl: { type: String, required: true, trim: true },
    caption: { type: String, default: "", trim: true },
    category: {
      type: String,
      default: "motivational",
      trim: true,
      enum: ["motivational", "funny", "productivity", "general"],
      index: true,
    },
    isActive: { type: Boolean, default: true, index: true },
    uploadedBy: { type: String, default: "", index: true },
    source: { type: String, default: "s3", trim: true },
  },
  { timestamps: true }
);

MemeSchema.index({ isActive: 1, category: 1, createdAt: -1 });
MemeSchema.index({ createdAt: -1 });

module.exports = mongoose.model("Meme", MemeSchema);