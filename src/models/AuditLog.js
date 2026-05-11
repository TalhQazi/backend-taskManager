const mongoose = require('mongoose');

const AuditLogSchema = new mongoose.Schema({
  employee_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  action: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  ip: { type: String, required: true },
}, { timestamps: true });

module.exports = mongoose.model('AuditLog', AuditLogSchema);