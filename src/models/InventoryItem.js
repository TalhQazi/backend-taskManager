const mongoose = require("mongoose");

const InventoryItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    sku: { type: String, unique: true },
    category: { type: String, enum: ["Raw Material", "Finished Good", "Service Item", "Office Supply"], default: "Finished Good" },
    quantity: { type: Number, default: 0 },
    unitOfMeasure: { type: String, default: "pcs" },
    unitCost: { type: Number, default: 0 },
    sellingPrice: { type: Number, default: 0 },
    reorderLevel: { type: Number, default: 5 },
    warehouse: { type: String },
    status: { type: String, enum: ["In Stock", "Low Stock", "Out of Stock"], default: "In Stock" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("InventoryItem", InventoryItemSchema);
