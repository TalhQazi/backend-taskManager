const mongoose = require('mongoose');

const DocumentSchema = new mongoose.Schema({
  employee_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  doc_type: { type: String, required: true },
  status: { type: String, enum: ['complete', 'incomplete'], required: true },
  file_url: { type: String, required: true },
}, { timestamps: true });

module.exports = mongoose.model('Document', DocumentSchema);