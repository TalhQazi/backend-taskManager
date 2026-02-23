const mongoose = require("mongoose");

const ApplianceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    category: { type: String, required: true },
    serialNumber: { type: String, required: true },
    status: {
      type: String,
      enum: ["operational", "needs-repair", "out-of-service"],
      default: "operational",
    },
    location: { type: String, required: true },
    warrantyExpiry: { type: String, default: "" },
    lastMaintenance: { type: String, default: "" },
    assignedTo: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Appliance", ApplianceSchema);
