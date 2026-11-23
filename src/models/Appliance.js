const mongoose = require("mongoose");

// Unified schema supporting Asset, Consumable, and Sellable inventory types
const ApplianceSchema = new mongoose.Schema(
  {
    frontendId: { type: String, required: true, unique: true },
    inventoryType: { type: String, enum: ["asset", "consumable", "sellable"], default: "asset" },
    name: { type: String, required: true },

    // Common fields
    brand: { type: String, default: "" },
    model: { type: String, default: "" },
    location: { type: String, default: "" },
    photoFileName: { type: String, default: "" },
    photoDataUrl: { type: String, default: "" },
    photoAttachment: {
      fileName: { type: String, default: "" },
      url: { type: String, default: "" },
      mimeType: { type: String, default: "" },
      size: { type: Number, default: 0 },
    },
    supplier: { type: String, default: "" },

    // Asset-specific fields
    serialNumber: { type: String, default: "" },
    propertyType: { type: String, enum: ["commercial", "residential"], default: "commercial" },
    purchaseDate: { type: String, default: "" },
    warrantyUntil: { type: String, default: "" },
    conditionStatus: { type: String, enum: ["excellent", "good", "fair", "damaged"], default: "good" },
    assignedTo: { type: String, default: "" },

    // Consumable-specific fields
    quantity: { type: Number, default: 0 },
    unitType: { type: String, enum: ["pieces", "boxes", "liters", "kg"], default: "pieces" },
    reorderPoint: { type: Number, default: 0 },
    dailyUsageRate: { type: Number, default: 0 },

    // Sellable-specific fields
    sku: { type: String, default: "" },
    costPrice: { type: Number, default: 0 },
    sellingPrice: { type: Number, default: 0 },

    // Unified status (meaning depends on inventoryType)
    status: { type: String, default: "active" },

    // Legacy compatibility
    category: { type: String, default: "appliance" },
    warrantyExpiry: { type: String, default: "" },
    lastMaintenance: { type: String, default: "" },
    tagPhotoFileName: { type: String, default: "" },
    tagPhotoDataUrl: { type: String, default: "" },
    tagPhotoAttachment: {
      fileName: { type: String, default: "" },
      url: { type: String, default: "" },
      mimeType: { type: String, default: "" },
      size: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

// Indexes for common queries
ApplianceSchema.index({ inventoryType: 1 });
ApplianceSchema.index({ status: 1 });
ApplianceSchema.index({ location: 1 });
ApplianceSchema.index({ assignedTo: 1 });
ApplianceSchema.index({ createdAt: -1 });

module.exports = mongoose.model("Appliance", ApplianceSchema);
