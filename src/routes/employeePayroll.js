const express = require('express');
const router = express.Router();
const PayrollRecord = require('../models/PayrollRecord');
const { requireAuth } = require('../middleware/auth');

// GET /employee/payroll - Get all payroll records for authenticated employee
router.get('/payroll', requireAuth, async (req, res) => {
  try {
    const userId = String(req.user?.sub || "");
    if (!userId) return res.status(401).json({ error: { message: "Unauthorized" } });

    const { page = 1, limit = 50, year } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const filter = { employee_id: userId };
    if (year) {
      filter.pay_period = { $regex: year };
    }

    const [records, total] = await Promise.all([
      PayrollRecord.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      PayrollRecord.countDocuments(filter)
    ]);

    const items = records.map(r => ({
      id: String(r._id),
      employeeId: String(r.employee_id),
      payPeriod: r.pay_period,
      gross: r.gross,
      net: r.net,
      taxes: r.taxes,
      deductions: r.deductions,
      pdfUrl: r.pdf_url,
      createdAt: r.createdAt,
    }));

    res.json({ items, total, page: Number(page), limit: Number(limit) });
  } catch (error) {
    console.error("Error fetching payroll records:", error);
    res.status(500).json({ error: 'Failed to fetch payroll records' });
  }
});

// GET /employee/payroll/:id - Get single payroll record with PDF download URL
router.get('/payroll/:id', requireAuth, async (req, res) => {
  try {
    const userId = String(req.user?.sub || "");
    if (!userId) return res.status(401).json({ error: { message: "Unauthorized" } });

    const record = await PayrollRecord.findOne({ _id: req.params.id, employee_id: userId }).lean();
    if (!record) {
      return res.status(404).json({ error: { message: "Payroll record not found" } });
    }

    res.json({
      item: {
        id: String(record._id),
        employeeId: String(record.employee_id),
        payPeriod: record.pay_period,
        gross: record.gross,
        net: record.net,
        taxes: record.taxes,
        deductions: record.deductions,
        pdfUrl: record.pdf_url,
        createdAt: record.createdAt,
      }
    });
  } catch (error) {
    console.error("Error fetching payroll record:", error);
    res.status(500).json({ error: 'Failed to fetch payroll record' });
  }
});

module.exports = router;