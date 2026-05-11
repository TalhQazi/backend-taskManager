const express = require('express');
const router = express.Router();
const PayrollRecord = require('../models/PayrollRecord');
const TimeLog = require('../models/TimeLog');
const Document = require('../models/Document');

// GET /employee/dashboard
router.get('/dashboard', async (req, res) => {
  try {
    const employeeId = req.user.id; // Assuming req.user contains authenticated user info

    const payroll = await PayrollRecord.find({ employee_id: employeeId });
    const timeLogs = await TimeLog.find({ employee_id: employeeId });
    const documents = await Document.find({ employee_id: employeeId });

    res.json({
      payroll,
      timeLogs,
      documents,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

module.exports = router;