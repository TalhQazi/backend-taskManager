const mongoose = require("mongoose");

const FinishRecordSchema = new mongoose.Schema(
  {
    organizationId: { type: String, default: "", index: true },
    propertyId: { type: String, required: true, index: true },
    propertyName: { type: String, default: "" },
    buildingId: { type: String, default: "" },
    buildingName: { type: String, default: "" },
    unitAreaId: { type: String, default: "" },
    unitAreaName: { type: String, default: "" },
    roomZoneId: { type: String, default: "" },
    roomZoneName: { type: String, default: "" },
    surfaceTypeId: { type: String, required: true, index: true },
    surfaceTypeName: { type: String, required: true, index: true },

    materialCategory: {
      type: String,
      default: "paint",
      enum: [
        "paint",
        "flooring",
        "tile",
        "grout",
        "caulk",
        "stain",
        "siding",
        "roofing",
        "cabinetry",
        "trim",
        "wallpaper",
        "countertops",
        "other",
      ],
      index: true,
    },

    recordStatus: {
      type: String,
      enum: ["CURRENT", "PREVIOUS", "DRAFT", "ARCHIVED"],
      default: "CURRENT",
      index: true,
    },

    manufacturer: { type: String, default: "", trim: true, index: true },
    productLine: { type: String, default: "", trim: true },
    colorName: { type: String, default: "", trim: true, index: true },
    colorCode: { type: String, default: "", trim: true, index: true },
    customMixFormula: { type: String, default: "" },
    sheenFinish: { type: String, default: "", trim: true, index: true },
    useType: {
      type: String,
      enum: ["Interior", "Exterior", "Both", "N/A"],
      default: "Interior",
      index: true,
    },
    primerUsed: { type: String, default: "" },
    coats: { type: Number, default: 2 },
    quantityUsed: { type: Number, default: 0 },
    quantityUnit: { type: String, default: "Gallons" },
    coverageNotes: { type: String, default: "" },

    purchasedFrom: { type: String, default: "", trim: true },
    storeLocation: { type: String, default: "", trim: true },
    unitCost: { type: Number, default: 0 },
    currency: { type: String, default: "USD" },

    dateApplied: { type: Date },
    appliedBy: { type: String, default: "" },
    notes: { type: String, default: "" },
    hexColor: { type: String, default: "" },

    isSharedTemplate: { type: Boolean, default: false },
    effectiveFrom: { type: Date, default: Date.now },
    effectiveTo: { type: Date, default: null },

    createdBy: { type: String, default: "" },
    createdByName: { type: String, default: "" },
    updatedBy: { type: String, default: "" },
    updatedByName: { type: String, default: "" },

    version: { type: Number, default: 1 },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

// Compound and search indexes
FinishRecordSchema.index({ propertyId: 1, recordStatus: 1 });
FinishRecordSchema.index({ propertyId: 1, unitAreaName: 1, surfaceTypeName: 1 });
FinishRecordSchema.index({ organizationId: 1, propertyId: 1 });
FinishRecordSchema.index({ colorCode: 1, manufacturer: 1 });
FinishRecordSchema.index({ createdAt: -1 });

module.exports = mongoose.model("FinishRecord", FinishRecordSchema);

