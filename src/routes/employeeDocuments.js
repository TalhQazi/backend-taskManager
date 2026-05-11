const express = require('express');
const router = express.Router();
const Document = require('../models/Document');
const { requireAuth } = require('../middleware/auth');

// GET /employee/documents - Get all documents for authenticated employee
router.get('/documents', requireAuth, async (req, res) => {
  try {
    const userId = String(req.user?.sub || "");
    if (!userId) return res.status(401).json({ error: { message: "Unauthorized" } });

    const { docType, status, page = 1, limit = 50 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const filter = { employee_id: userId };
    if (docType) {
      filter.doc_type = docType;
    }
    if (status) {
      filter.status = status;
    }

    const [documents, total] = await Promise.all([
      Document.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Document.countDocuments(filter)
    ]);

    const items = documents.map(d => ({
      id: String(d._id),
      employeeId: String(d.employee_id),
      docType: d.doc_type,
      status: d.status,
      fileUrl: d.file_url,
      createdAt: d.createdAt,
    }));

    res.json({ items, total, page: Number(page), limit: Number(limit) });
  } catch (error) {
    console.error("Error fetching documents:", error);
    res.status(500).json({ error: 'Failed to fetch documents' });
  }
});

// GET /employee/documents/types - Get available document types
router.get('/documents/types', requireAuth, async (req, res) => {
  try {
    const userId = String(req.user?.sub || "");
    if (!userId) return res.status(401).json({ error: { message: "Unauthorized" } });

    const types = await Document.distinct("doc_type", { employee_id: userId });
    res.json({ types });
  } catch (error) {
    console.error("Error fetching document types:", error);
    res.status(500).json({ error: 'Failed to fetch document types' });
  }
});

// GET /employee/documents/:id - Get single document
router.get('/documents/:id', requireAuth, async (req, res) => {
  try {
    const userId = String(req.user?.sub || "");
    if (!userId) return res.status(401).json({ error: { message: "Unauthorized" } });

    const doc = await Document.findOne({ _id: req.params.id, employee_id: userId }).lean();
    if (!doc) {
      return res.status(404).json({ error: { message: "Document not found" } });
    }

    res.json({
      item: {
        id: String(doc._id),
        employeeId: String(doc.employee_id),
        docType: doc.doc_type,
        status: doc.status,
        fileUrl: doc.file_url,
        createdAt: doc.createdAt,
      }
    });
  } catch (error) {
    console.error("Error fetching document:", error);
    res.status(500).json({ error: 'Failed to fetch document' });
  }
});

module.exports = router;