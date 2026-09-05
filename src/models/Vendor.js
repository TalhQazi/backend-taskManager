const mongoose = require("mongoose");

const vendorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    phone: { type: String, required: true },
    email: { type: String, default: "" },
    street: { type: String, default: "" },
    city: { type: String, default: "" },
    state: { type: String, default: "" },
    zip: { type: String, default: "" },
    website: { type: String, default: "" },
    serviceType: { type: String, required: true },
    location: { type: String, required: false },
    status: { 
      type: String, 
      enum: ["approved", "not-approved"], 
      default: "approved" 
    },
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

// Index for faster location-based queries
vendorSchema.index({ location: 1 });
vendorSchema.index({ status: 1 });

module.exports = mongoose.model("Vendor", vendorSchema);
