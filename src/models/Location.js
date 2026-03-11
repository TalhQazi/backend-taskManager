const mongoose = require("mongoose");

const LocationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    type: { type: String, enum: ["office", "warehouse", "facility", "site"], required: true },
    address: { type: String, required: true },
    city: { type: String, required: true },
    country: { type: String, default: "" },
    phone: { type: String, default: "" },
    manager: { type: String, default: "" },
    employeeCount: { type: Number, default: 0 },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
    operatingHours: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Location", LocationSchema);