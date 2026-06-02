const mongoose = require("mongoose");

const LeaseSchema = new mongoose.Schema(
  {
    tenant: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true },
    property: { type: mongoose.Schema.Types.ObjectId, ref: "Property", required: true },
    unit: { type: mongoose.Schema.Types.ObjectId, ref: "Unit", required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date },
    rentAmount: { type: Number, required: true },
    depositAmount: { type: Number },
    status: { type: String, enum: ["Active", "Terminated", "Expired", "Pending"], default: "Pending" },
    terms: { type: String },
    attachments: [{ fileName: String, url: String }],
  },
  { timestamps: true }
);

module.exports = mongoose.model("Lease", LeaseSchema);
