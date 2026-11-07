const mongoose = require("mongoose");

const appStoreLinkSchema = new mongoose.Schema(
  {
    appName: {
      type: String,
      required: true,
      trim: true,
    },
    brand: {
      type: String,
      default: "",
      trim: true,
    },
    googlePlayUrl: {
      type: String,
      default: "",
      trim: true,
    },
    appleStoreUrl: {
      type: String,
      default: "",
      trim: true,
    },
    status: {
      type: String,
      enum: ["Active", "Inactive", "Coming Soon"],
      default: "Active",
    },
    notes: {
      type: String,
      default: "",
    },
    createdBy: {
      type: String,
      default: "System",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AppStoreLink", appStoreLinkSchema);
