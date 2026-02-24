const mongoose = require("mongoose");

const VehicleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    make: { type: String, default: "" },
    model: { type: String, default: "" },
    year: { type: String, default: "" },
    type: { type: String, default: "" },
    licensePlate: { type: String, required: true },
    vin: { type: String, default: "" },
    status: {
      type: String,
      enum: ["available", "in-use", "maintenance", "active", "inactive"],
      default: "available",
    },
    assignedTo: { type: String, default: null },
    fuelLevel: { type: Number, default: 100 },
    mileage: { type: Number, default: 0 },
    mileageText: { type: String, default: "" },
    lastInspection: { type: Date },
    nextInspection: { type: Date },
    registrationFileName: { type: String, default: "" },
    insuranceFileName: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Vehicle", VehicleSchema);
