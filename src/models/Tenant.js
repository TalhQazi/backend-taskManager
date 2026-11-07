const mongoose = require("mongoose");

const TenantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String },
    phone: { type: String },
    type: { type: String, enum: ["Individual", "Company"], default: "Individual" },
    status: { type: String, enum: ["Active", "Former", "Prospect"], default: "Prospect" },
    identification: { type: String }, // SSN/EIN/ID
    notes: { type: String },
    company: { type: mongoose.Schema.Types.ObjectId, ref: "Company" },
    assignedProperty: { type: String },
    assignedUnit: { type: String },
    locationName: { type: String },
    address: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Tenant", TenantSchema);
