const mongoose = require("mongoose");

const OnboardingSchema = new mongoose.Schema(
  {
    employeeName: { type: String, required: true },
    role: { type: String, required: true },
    startDate: { type: String, required: true },
    progress: { type: Number, default: 0 },
    documentsUploaded: { type: Number, default: 0 },
    documentsRequired: { type: Number, default: 0 },
    approvalStatus: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
  },
  { timestamps: true }
);

OnboardingSchema.index({ approvalStatus: 1 });
OnboardingSchema.index({ employeeName: 1 });

module.exports = mongoose.model("Onboarding", OnboardingSchema);
