const mongoose = require("mongoose");

const FixedAssetSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    assetTag: { type: String, unique: true },
    category: { type: String, enum: ["Land", "Building", "Vehicle", "Equipment", "Furniture", "IT Hardware"], required: true },
    purchaseDate: { type: Date, required: true },
    purchasePrice: { type: Number, required: true },
    salvageValue: { type: Number, default: 0 },
    usefulLifeYears: { type: Number, default: 5 },
    depreciationMethod: { type: String, enum: ["Straight Line", "Declining Balance"], default: "Straight Line" },
    accumulatedDepreciation: { type: Number, default: 0 },
    currentBookValue: { type: Number },
    status: { type: String, enum: ["Active", "Disposed", "Fully Depreciated"], default: "Active" },
    location: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model("FixedAsset", FixedAssetSchema);
