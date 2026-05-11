const mongoose = require('mongoose');

const TimeLogSchema = new mongoose.Schema({
  employee_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  clock_in: { type: Date, required: true },
  clock_out: { type: Date, required: true },
  total_hours: { type: Number, required: true },
}, { timestamps: true });

module.exports = mongoose.model('TimeLog', TimeLogSchema);