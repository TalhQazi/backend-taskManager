const mongoose = require("mongoose");

const FinishAssignmentSchema = new mongoose.Schema(
  {
    finishRecordId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FinishRecord",
      required: true,
    },
    propertyId: { type: String, required: true, index: true },
    propertyName: { type: String, default: "" },
    buildingId: { type: String, default: "" },
    buildingName: { type: String, default: "" },
    unitAreaId: { type: String, default: "" },
    unitAreaName: { type: String, default: "" },
    roomZoneId: { type: String, default: "" },
    roomZoneName: { type: String, default: "" },
    surfaceTypeId: { type: String, required: true, index: true },
    surfaceTypeName: { type: String, default: "" },

    isCurrent: { type: Boolean, default: true, index: true },
    effectiveFrom: { type: Date, default: Date.now },
    effectiveTo: { type: Date, default: null },

    createdBy: { type: String, default: "" },
    createdByName: { type: String, default: "" },
  },
  { timestamps: true }
);

FinishAssignmentSchema.index({ propertyId: 1, surfaceTypeId: 1, unitAreaName: 1, isCurrent: 1 });
FinishAssignmentSchema.index({ finishRecordId: 1 });

module.exports = mongoose.model("FinishAssignment", FinishAssignmentSchema);
