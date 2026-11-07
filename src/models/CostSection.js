const mongoose = require("mongoose");

// User-defined groups inside a cost sheet
// (Materials, Manufacturing, Testing, UL Listing, Permits, Shipping, Taxes, ...).
const CostSectionSchema = new mongoose.Schema(
  {
    costSheetId: { type: mongoose.Schema.Types.ObjectId, ref: "CostSheet", required: true, index: true },
    name: { type: String, required: true, trim: true },
    sortOrder: { type: Number, default: 0 },
    isRequired: { type: Boolean, default: false },
  },
  { timestamps: true }
);

CostSectionSchema.index({ costSheetId: 1, sortOrder: 1 });

module.exports = mongoose.model("CostSection", CostSectionSchema);
