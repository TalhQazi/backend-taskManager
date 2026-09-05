const mongoose = require("mongoose");

const CRMDealSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, index: true },
    company: { type: String, required: true, index: true },
    value: { type: Number, required: true, default: 0 },
    stage: {
      type: String,
      enum: ["Qualification", "Needs Analysis", "Proposal", "Negotiation", "Closed Won", "Closed Lost"],
      default: "Qualification",
      index: true,
    },
    probability: { type: Number, default: 50, min: 0, max: 100 },
    closeDate: { type: Date, required: true },
    owner: { type: String, default: "Unassigned" },
  },
  { timestamps: true }
);

// Compound indexes for common queries
CRMDealSchema.index({ company: 1, stage: 1 });
CRMDealSchema.index({ createdAt: -1 });
CRMDealSchema.index({ owner: 1 });

module.exports = mongoose.model("CRMDeal", CRMDealSchema);