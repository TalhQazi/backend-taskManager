const mongoose = require("mongoose");

const LocationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    type: { type: String, enum: ["office", "warehouse", "facility", "site"], required: true },
    address: { type: String, default: "" },
    city: { type: String, required: true },
    country: { type: String, default: "" },
    phone: { type: String, default: "" },
    manager: { type: String, default: "" },
    employeeCount: { type: Number, default: 0 },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
    operatingHours: { type: String, default: "" },
    photoDataUrl: { type: String, default: "" },
    photoFileName: { type: String, default: "" },
    photoHeight: { type: Number, default: 48 },
  },
  { timestamps: true }
);

// Indexes for common queries
LocationSchema.index({ status: 1 });
LocationSchema.index({ name: 1 });
LocationSchema.index({ city: 1 });

module.exports = mongoose.model("Location", LocationSchema);