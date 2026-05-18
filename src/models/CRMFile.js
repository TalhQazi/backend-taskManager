const mongoose = require("mongoose");

const crmFileSchema = new mongoose.Schema(
  {
    originalName: {
      type: String,
      required: true,
      trim: true,
    },
    fileName: {
      type: String,
      required: true,
      trim: true,
    },
    mimeType: {
      type: String,
      required: true,
      trim: true,
    },
    size: {
      type: Number,
      required: true,
    },
    url: {
      type: String,
      required: true,
      trim: true,
    },
    linkedContact: {
      type: String,
      default: "",
      trim: true,
    },
    linkedDeal: {
      type: String,
      default: "",
      trim: true,
    },
    type: {
      type: String,
      enum: ['Contract', 'Proposal', 'Invoice', 'Other'],
      default: 'Other',
      trim: true,
    },
    date: {
      type: Date,
      default: Date.now,
    },
    uploadedAt: {
      type: Date,
      default: Date.now,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  }
);

crmFileSchema.index({ uploadedAt: -1 });
crmFileSchema.index({ linkedContact: 1 });
crmFileSchema.index({ linkedDeal: 1 });

module.exports = mongoose.model("CRMFile", crmFileSchema);
