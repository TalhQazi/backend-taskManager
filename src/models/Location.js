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
    attachments: [
      {
        fileName: { type: String, default: "" },
        url: { type: String, default: "" },
      },
    ],
    complianceChecklist: {
      water: {
        status: { type: String, default: "Pending" },
        notes: { type: String, default: "" },
      },
      power: {
        status: { type: String, default: "Pending" },
        notes: { type: String, default: "" },
      },
      townPermitDemo: {
        status: { type: String, default: "Pending" },
        notes: { type: String, default: "" },
      },
      townPermitRenovations: {
        status: { type: String, default: "Pending" },
        notes: { type: String, default: "" },
      },
      sitePlanReview: {
        option: { type: String, default: "Needed" }, // "Needed" | "Not Needed" | "Approved" | "Pending"
        notes: { type: String, default: "" },
      },
      certificateOfOccupancy: {
        status: { type: String, default: "Pending" }, // "Obtained" | "Pending" | "In Review" | "N/A"
        date: { type: String, default: "" },
        notes: { type: String, default: "" },
      },
    },
  },
  { timestamps: true }
);

// Indexes for common queries
LocationSchema.index({ status: 1 });
LocationSchema.index({ name: 1 });
LocationSchema.index({ city: 1 });
LocationSchema.index({ createdAt: -1 });

module.exports = mongoose.model("Location", LocationSchema);