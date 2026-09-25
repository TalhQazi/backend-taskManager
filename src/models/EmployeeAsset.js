const mongoose = require("mongoose");

/**
 * EmployeeAsset Schema
 * ────────────────────
 * Tracks company equipment, devices, vehicles, keys, badges, tools,
 * and software access licenses assigned to an employee.
 */
const EmployeeAssetSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
      index: true,
    },
    assetType: {
      type: String,
      enum: [
        "laptop",
        "phone",
        "tablet",
        "vehicle",
        "key",
        "badge",
        "tool",
        "software_access",
        "credit_card",
        "uniform",
        "other",
      ],
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    identifier: { type: String, default: "" }, // Serial Number, Asset Tag, License Key, Plate Number, Badge ID
    details: { type: String, default: "" }, // Model, specs, system name
    assignedDate: { type: Date, default: Date.now, required: true },
    returnDate: { type: Date, default: null },
    expectedReturnDate: { type: Date, default: null },
    status: {
      type: String,
      enum: ["assigned", "returned", "lost", "damaged", "pending_return"],
      default: "assigned",
      index: true,
    },
    conditionOnAssignment: { type: String, default: "good" },
    conditionOnReturn: { type: String, default: "" },
    notes: { type: String, default: "" },
    assignedBy: { type: String, default: "" },
    assignedByName: { type: String, default: "" },
    receivedBySignature: { type: String, default: "" },
  },
  { timestamps: true }
);

EmployeeAssetSchema.index({ employeeId: 1, status: 1 });

module.exports = mongoose.model("EmployeeAsset", EmployeeAssetSchema);
