const express = require("express");
const { generateAuditLedger, exportAuditCsv } = require("../../services/companyReels/auditService");
const { requireRole } = require("../../middleware/auth");

const router = express.Router();
const allowedAuditRoles = ["admin", "super-admin", "manager"];

/**
 * GET /api/company-reels/admin/audit-ledger
 * Returns JSON compliance audit ledger with KPIs and filtering.
 */
router.get("/admin/audit-ledger", requireRole(allowedAuditRoles), async (req, res) => {
  try {
    const ledger = await generateAuditLedger(req.query);
    return res.json({ success: true, data: ledger });
  } catch (err) {
    console.error("[Audit Service] Ledger error:", err);
    return res.status(500).json({ error: { message: err.message || "Failed to generate audit ledger" } });
  }
});

/**
 * GET /api/company-reels/admin/audit-export
 * Downloads RFC 4180 CSV compliance audit inspection report.
 */
router.get("/admin/audit-export", requireRole(allowedAuditRoles), async (req, res) => {
  try {
    const csvContent = await exportAuditCsv(req.query);
    const filename = `company_reels_compliance_audit_${new Date().toISOString().split("T")[0]}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send(csvContent);
  } catch (err) {
    console.error("[Audit Service] Export error:", err);
    return res.status(500).json({ error: { message: err.message || "Failed to export audit CSV" } });
  }
});

module.exports = router;
