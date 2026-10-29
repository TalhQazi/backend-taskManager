const mongoose = require("mongoose");

const CompanyLocationSchema = new mongoose.Schema(
  {
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    label: {
      type: String,
      required: true,
      trim: true,
    },
    address: {
      street: { type: String, default: "" },
      city: { type: String, default: "" },
      state: { type: String, default: "" },
      zipCode: { type: String, default: "" },
      country: { type: String, default: "" },
    },
    isPrimary: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

// Indexes for common queries
CompanyLocationSchema.index({ company: 1 });
CompanyLocationSchema.index({ company: 1, isPrimary: 1 });
CompanyLocationSchema.index({ isActive: 1 });

module.exports = mongoose.model("CompanyLocation", CompanyLocationSchema);
