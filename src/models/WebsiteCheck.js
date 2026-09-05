const mongoose = require("mongoose");

const websiteCheckSchema = new mongoose.Schema(
  {
    websiteId: { type: mongoose.Schema.Types.ObjectId, ref: "Website", required: true },
    status: { type: String, enum: ["LIVE", "DEGRADED", "DOWN", "UNKNOWN"], required: true },
    responseTimeMs: { type: Number, required: true },
    statusCode: { type: Number },
    errorDetails: { type: String },
    checkedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

websiteCheckSchema.index({ websiteId: 1, checkedAt: -1 });

module.exports = mongoose.model("WebsiteCheck", websiteCheckSchema);
