const mongoose = require('mongoose');

const TaxDocumentSchema = new mongoose.Schema({
  employee_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  year: { type: Number, required: true },
  type: { type: String, enum: ['W-2', '1099'], required: true },
  file_url: { type: String, required: true },
}, { timestamps: true });

module.exports = mongoose.model('TaxDocument', TaxDocumentSchema);