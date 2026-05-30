const mongoose = require("mongoose");

const crmContactSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    company: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ["Active", "Pending", "Inactive"],
      default: "Active",
    },
    tags: {
      type: [String],
      default: [],
    },
    relationshipType: {
      type: String,
      enum: ["Client", "Lead", "Partner"],
      default: "Lead",
    },
    address: {
      type: String,
      trim: true,
    },
    notes: {
      type: String,
      trim: true,
    },
    continuityScore: {
      type: Number,
      default: 100,
      min: 0,
      max: 100,
      index: true,
    },
    revenueGravityScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
      index: true,
    },
    accountValue: {
      type: Number,
      default: 0,
    },
    lastInteractionDate: {
      type: Date,
      default: Date.now,
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
crmContactSchema.index({ status: 1 });
crmContactSchema.index({ company: 1 });

module.exports = mongoose.model("CRMContact", crmContactSchema);
