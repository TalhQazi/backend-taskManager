const mongoose = require("mongoose");

const DoNotHireSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true },
    phone: { type: String, default: null },
    email: { type: String, default: null },
    reason: { type: String, required: true },
    incidentNotes: { type: String, required: true },
    createdAt: { type: String, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("DoNotHire", DoNotHireSchema);
