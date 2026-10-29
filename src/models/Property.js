const mongoose = require("mongoose");

const PropertySchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    address: { type: String, required: true },
    parcelInformation: { type: String },
    purchasePrice: { type: Number },
    purchaseDate: { type: Date },
    ownershipType: { type: String, default: "Sole Ownership" },
    status: {
      type: String,
      enum: ["Active", "Maintenance", "Sold", "Pending"],
      default: "Active",
    },
    company: { type: mongoose.Schema.Types.ObjectId, ref: "Company" },
    assignedCustomer: { type: String },
    assignedUnit: { type: String },
    locationName: { type: String },
    metadata: { type: Map, of: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Property", PropertySchema);
