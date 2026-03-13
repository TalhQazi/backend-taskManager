const mongoose = require("mongoose");

const ApplianceSchema = new mongoose.Schema(
  {
    frontendId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    category: { type: String, default: "appliance" },
    serialNumber: { type: String, default: "" },
    status: {
      type: String,
      enum: ["operational", "needs-repair", "out-of-service"],
      default: "operational",
    },
    location: { type: String, required: true },
    warrantyExpiry: { type: String, default: "" },
    lastMaintenance: { type: String, default: "" },
    assignedTo: { type: String, default: null },
    tagPhotoFileName: { type: String, default: "" },
    tagPhotoDataUrl: { type: String, default: "" },
    tagPhotoAttachment: {
      fileName: { type: String, default: "" },
      url: { type: String, default: "" },
      mimeType: { type: String, default: "" },
      size: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Appliance", ApplianceSchema);
