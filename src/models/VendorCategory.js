const mongoose = require("mongoose");

const vendorCategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("VendorCategory", vendorCategorySchema);
