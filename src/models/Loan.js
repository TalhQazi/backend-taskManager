const mongoose = require("mongoose");

const LoanSchema = new mongoose.Schema(
  {
    lender: { type: String, required: true },
    loanType: { type: String, enum: ["Mortgage", "Line of Credit", "Term Loan", "SBA Loan"], required: true },
    principalAmount: { type: Number, required: true },
    interestRate: { type: Number, required: true }, // Annual percentage
    termMonths: { type: Number, required: true },
    startDate: { type: Date, required: true },
    monthlyPayment: { type: Number },
    remainingBalance: { type: Number },
    status: { type: String, enum: ["Active", "Closed", "Defaulted"], default: "Active" },
    property: { type: mongoose.Schema.Types.ObjectId, ref: "Property" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Loan", LoanSchema);
