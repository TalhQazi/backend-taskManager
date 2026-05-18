const mongoose = require("mongoose");

const UnitSchema = new mongoose.Schema(
  {
    property: { type: mongoose.Schema.Types.ObjectId, ref: "Property", required: true },
    unitNumber: { type: String, required: true },
    type: { type: String, enum: ["Residential", "Commercial", "Industrial"], default: "Residential" },
    status: {
      type: String,
      enum: ["Vacant", "Occupied", "Under Repair", "Reserved"],
      default: "Vacant",
    },
    rentalPrice: { type: Number },
    occupantName: { type: String },
    leaseStartDate: { type: Date },
    leaseEndDate: { type: Date },
    profitability: { type: Number, default: 0 },
    metadata: { type: Map, of: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Unit", UnitSchema);
