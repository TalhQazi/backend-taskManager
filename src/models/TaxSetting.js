const mongoose = require("mongoose");

const TaxSettingSchema = new mongoose.Schema(
  {
    country: { type: String, required: true },
    taxName: { type: String, required: true }, // VAT, GST, Sales Tax
    rate: { type: Number, required: true },
    isActive: { type: Boolean, default: true },
    account: { type: mongoose.Schema.Types.ObjectId, ref: "AtlasAccount" }, // Liability account for tax payable
  },
  { timestamps: true }
);

module.exports = mongoose.model("TaxSetting", TaxSettingSchema);
