const express = require('express');
const router = express.Router();
const TaxDocument = require('../models/TaxDocument');
const { requireAuth } = require('../middleware/auth');

// GET /employee/tax-docs - Get all tax documents for authenticated employee
router.get('/tax-docs', requireAuth, async (req, res) => {
  try {
    const userId = String(req.user?.sub || "");
    if (!userId) return res.status(401).json({ error: { message: "Unauthorized" } });

    const { year, type, page = 1, limit = 50 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const filter = { employee_id: userId };
    if (year) {
      filter.year = Number(year);
    }
    if (type) {
      filter.type = type;
    }

    const [docs, total] = await Promise.all([
      TaxDocument.find(filter)
        .sort({ year: -1, type: 1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      TaxDocument.countDocuments(filter)
    ]);

    const items = docs.map(d => ({
      id: String(d._id),
      employeeId: String(d.employee_id),
      year: d.year,
      type: d.type,
      fileUrl: d.file_url,
      createdAt: d.createdAt,
    }));

    res.json({ items, total, page: Number(page), limit: Number(limit) });
  } catch (error) {
    console.error("Error fetching tax documents:", error);
    res.status(500).json({ error: 'Failed to fetch tax documents' });
  }
});

// GET /employee/tax-docs/years - Get available tax years
router.get('/tax-docs/years', requireAuth, async (req, res) => {
  try {
    const userId = String(req.user?.sub || "");
    if (!userId) return res.status(401).json({ error: { message: "Unauthorized" } });

    const years = await TaxDocument.distinct("year", { employee_id: userId });
    res.json({ years: years.sort((a, b) => b - a) });
  } catch (error) {
    console.error("Error fetching tax years:", error);
    res.status(500).json({ error: 'Failed to fetch tax years' });
  }
});

// GET /employee/tax-docs/:id - Get single tax document
router.get('/tax-docs/:id', requireAuth, async (req, res) => {
  try {
    const userId = String(req.user?.sub || "");
    if (!userId) return res.status(401).json({ error: { message: "Unauthorized" } });

    const doc = await TaxDocument.findOne({ _id: req.params.id, employee_id: userId }).lean();
    if (!doc) {
      return res.status(404).json({ error: { message: "Tax document not found" } });
    }

    res.json({
      item: {
        id: String(doc._id),
        employeeId: String(doc.employee_id),
        year: doc.year,
        type: doc.type,
        fileUrl: doc.file_url,
        createdAt: doc.createdAt,
      }
    });
  } catch (error) {
    console.error("Error fetching tax document:", error);
    res.status(500).json({ error: 'Failed to fetch tax document' });
  }
});

module.exports = router;