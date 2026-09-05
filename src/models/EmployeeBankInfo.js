const mongoose = require("mongoose");

/**
 * EmployeeBankInfo Schema
 * ───────────────────────
 * Secure direct deposit and banking information.
 * Account number and Routing number are AES-256-GCM encrypted.
 * Masked values are stored for default display (`•••• 6789`).
 */
const EmployeeBankInfoSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
      unique: true,
      index: true,
    },
    bankName: { type: String, default: "" },
    accountHolderName: { type: String, default: "" },
    accountType: {
      type: String,
      enum: ["checking", "savings", "other"],
      default: "checking",
    },
    // AES-256-GCM encrypted strings
    accountNumberEncrypted: { type: String, default: "" },
    routingNumberEncrypted: { type: String, default: "" },
    // Masked presentation strings (e.g. "•••• 4589")
    accountNumberMasked: { type: String, default: "" },
    routingNumberMasked: { type: String, default: "" },
    directDepositPercentage: { type: Number, default: 100 },
    isVerified: { type: Boolean, default: false },
    updatedBy: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("EmployeeBankInfo", EmployeeBankInfoSchema);
