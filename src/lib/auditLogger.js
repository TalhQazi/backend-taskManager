const AuditLog = require('../models/AuditLog');

const AUDIT_ACTIONS = {
  LOGIN: 'login',
  LOGOUT: 'logout',
  PROFILE_VIEW: 'profile_view',
  PROFILE_UPDATE: 'profile_update',
  PAYROLL_VIEW: 'payroll_view',
  PAY_STUB_DOWNLOAD: 'pay_stub_download',
  TAX_DOC_VIEW: 'tax_doc_view',
  TAX_DOC_DOWNLOAD: 'tax_doc_download',
  DOCUMENT_VIEW: 'document_view',
  DOCUMENT_UPLOAD: 'document_upload',
  DOCUMENT_DOWNLOAD: 'document_download',
  TIME_LOGS_VIEW: 'time_logs_view',
  SETTINGS_UPDATE: 'settings_update',
  MFA_ENABLED: 'mfa_enabled',
  MFA_DISABLED: 'mfa_disabled',
};

async function logAudit(req, action) {
  try {
    const userId = req.user?.sub || req.user?.id;
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';

    if (!userId) return;

    await AuditLog.create({
      employee_id: userId,
      action,
      ip,
      timestamp: new Date()
    });
  } catch (err) {
    console.error('Audit logging failed:', err);
  }
}

module.exports = {
  logAudit,
  AUDIT_ACTIONS
};
