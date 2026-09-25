const mongoose = require("mongoose");

const companyRegistrySchema = new mongoose.Schema(
  {
    companyName: { type: String, required: true, trim: true },
    entityType: { type: String, default: "" },
    fein: { type: String, default: "" },
    phone: { type: String, default: "" },
    email: { type: String, default: "" },
    status: { type: String, enum: ["active", "inactive", "hold", "archived"], default: "active" },
    notes: { type: String, default: "" },
    attachments: {
      type: [
        {
          name: { type: String, default: "" },
          url: { type: String, default: "" },
          type: { type: String, default: "" },
        },
      ],
      default: [],
    },
    colorTag: {
      type: String,
      enum: ["green", "blue", "yellow", "red", "gray"],
      default: "blue",
    },
  },
  { timestamps: true }
);

companyRegistrySchema.index({ companyName: 1 });
companyRegistrySchema.index({ fein: 1 });
companyRegistrySchema.index({ email: 1 });
companyRegistrySchema.index({ status: 1 });
companyRegistrySchema.index({ colorTag: 1 });

module.exports = mongoose.model("CompanyRegistry", companyRegistrySchema);
