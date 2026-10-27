const mongoose = require("mongoose");

const PhoneDirectorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      required: true,
      enum: [
        "Fire Brigade",
        "Police",
        "Medical / Ambulance",
        "Hospital",
        "Security",
        "Utility",
        "Municipal / Government",
        "Maintenance / Contractor",
        "Tow / Roadside",
        "Emergency Management",
        "Other",
      ],
      default: "Other",
    },
    phoneNumber: {
      type: String,
      required: true,
      trim: true,
    },
    secondaryPhone: {
      type: String,
      default: "",
      trim: true,
    },
    extension: {
      type: String,
      default: "",
      trim: true,
    },
    contactPerson: {
      type: String,
      default: "",
      trim: true,
    },
    email: {
      type: String,
      default: "",
      trim: true,
    },
    address: {
      type: String,
      default: "",
      trim: true,
    },
    locationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Location",
      default: null,
    },
    locationName: {
      type: String,
      default: "",
      trim: true,
    },
    isAllLocations: {
      type: Boolean,
      default: false,
    },
    priority: {
      type: String,
      enum: ["emergency", "high", "standard"],
      default: "standard",
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
    operatingHours: {
      type: String,
      default: "24/7",
      trim: true,
    },
    notes: {
      type: String,
      default: "",
    },
    // Banking Details (Super-Admin only & Password protected)
    bankName: {
      type: String,
      default: "",
      trim: true,
    },
    accountNo: {
      type: String,
      default: "",
      trim: true,
    },
    accountNumberEncrypted: {
      type: String,
      default: "",
    },
    accountNumberMasked: {
      type: String,
      default: "",
      trim: true,
    },
    hasBankDetails: {
      type: Boolean,
      default: false,
    },
    bankPasswordHash: {
      type: String,
      default: "",
    },
    createdBy: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

// Indexes for fast searching and filtering
PhoneDirectorySchema.index({ name: 1 });
PhoneDirectorySchema.index({ phoneNumber: 1 });
PhoneDirectorySchema.index({ locationId: 1 });
PhoneDirectorySchema.index({ isAllLocations: 1 });
PhoneDirectorySchema.index({ category: 1 });
PhoneDirectorySchema.index({ priority: 1 });
PhoneDirectorySchema.index({ status: 1 });
PhoneDirectorySchema.index({ createdAt: -1 });

module.exports = mongoose.model("PhoneDirectory", PhoneDirectorySchema);
