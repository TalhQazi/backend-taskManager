const mongoose = require("mongoose");

const payrollSchema = new mongoose.Schema(
  {
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
    payPeriod: { type: String, required: true },
    gross: Number,
    net: Number,
    taxes: Number,
    deductions: Number,
    pdfUrl: String,
  },
  { timestamps: true }
);


module.exports = mongoose.model(
  "PayrollRecord",
  payrollSchema,
  "payroll_records" 
);