const mongoose = require("mongoose");

const crmCompanySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    industry: {
      type: String,
      required: true,
      enum: ["Technology", "Finance", "Healthcare", "Retail", "Manufacturing", "Logistics", "Other"],
      trim: true,
    },
    contactCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    activeDeals: {
      type: Number,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      enum: ["Active", "Prospect", "Inactive"],
      default: "Active",
    },
    website: {
      type: String,
      trim: true,
      default: "",
    },
    location: {
      type: String,
      trim: true,
      default: "",
    },
    description: {
      type: String,
      trim: true,
      default: "",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  }
);

// Index for faster queries
crmCompanySchema.index({ status: 1 });
crmCompanySchema.index({ industry: 1 });

module.exports = mongoose.model("CRMCompany", crmCompanySchema);
