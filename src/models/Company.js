const mongoose = require("mongoose");

const companySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },
    sequence: {
      type: Number,
      required: true,
      unique: true,
    },
    description: {
      type: String,
      trim: true,
    },
    address: {
      street: String,
      city: String,
      state: String,
      zipCode: String,
      country: String,
    },
    contact: {
      email: String,
      phone: String,
      website: String,
    },
    status: {
      type: String,
      enum: ["active", "inactive", "suspended"],
      default: "active",
    },
    settings: {
      timezone: {
        type: String,
        default: "UTC",
      },
      dateFormat: {
        type: String,
        default: "MM/DD/YYYY",
      },
      currency: {
        type: String,
        default: "USD",
      },
    },
    logo: {
      type: String,
      default: "",
    },
    // Corporate Compliance Fields
    einNumber: {
      type: String,
      trim: true,
      default: "",
    },
    unemploymentId: {
      type: String,
      trim: true,
      default: "",
    },
    salesTaxId: {
      type: String,
      trim: true,
      default: "",
    },
    eftpsNumber: {
      type: String,
      trim: true,
      default: "",
    },
    registeredInOperatingState: {
      type: String,
      trim: true,
      default: "Registered", // "Registered" | "Pending" | "Not Registered"
    },
    operatingStateDetails: {
      type: String,
      trim: true,
      default: "",
    },
    charterNumber: {
      type: String,
      trim: true,
      default: "",
    },
    stateOfIncorporation: {
      type: String,
      trim: true,
      default: "",
    },
    foreignEntities: [
      {
        state: { type: String, trim: true },
        documentNumber: { type: String, trim: true },
      }
    ],
    originalFilingDate: {
      type: Date,
    },
    annualReportDueDate: {
      type: Date,
    },
    lastAnnualReportReminderSent: {
      type: Date,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  }
);

// Index for faster queries
companySchema.index({ status: 1 });

module.exports = mongoose.model("Company", companySchema);
