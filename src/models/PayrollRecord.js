const mongoose = require('mongoose');

const PayrollRecordSchema = new mongoose.Schema({
  employee_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  pay_period: { type: String, required: true },
  gross: { type: Number, required: true },
  net: { type: Number, required: true },
  taxes: { type: Number, required: true },
  deductions: { type: Number, required: true },
  pdf_url: { type: String, required: true },
}, { timestamps: true });

module.exports = mongoose.model('PayrollRecord', PayrollRecordSchema);