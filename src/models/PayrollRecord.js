const mongoose = require("mongoose");

const PayrollRecordSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
    payPeriodStart: { type: Date, required: true },
    payPeriodEnd: { type: Date, required: true },
    baseSalary: { type: Number, required: true },
    bonuses: { type: Number, default: 0 },
    deductions: { type: Number, default: 0 },
    netPay: { type: Number, required: true },
    status: { type: String, enum: ["Draft", "Processed", "Paid", "Void"], default: "Draft" },
    paymentDate: { type: Date },
    paymentMethod: { type: String, default: "Direct Deposit" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PayrollRecord", PayrollRecordSchema);
