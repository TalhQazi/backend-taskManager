const mongoose = require("mongoose");

const VehicleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    type: { type: String, default: "" },
    licensePlate: { type: String, required: true },
    status: { type: String, enum: ["available", "in-use", "maintenance"], default: "available" },
    assignedTo: { type: String, default: null },
    fuelLevel: { type: Number, default: 100 },
    mileage: { type: Number, default: 0 },
    lastInspection: { type: Date },
    nextInspection: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Vehicle", VehicleSchema);
