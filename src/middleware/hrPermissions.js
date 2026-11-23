const Employee = require("../models/Employee");

/**
 * HR Permissions & Access Scope Engine
 * ────────────────────────────────────
 * Implements deny-by-default authorization for Employee Records and HR Files.
 *
 * Roles:
 *   - super-admin: Unrestricted full access across all employees and sensitive fields
 *   - admin: Full HR management access, sensitive reveal access with step-up verification
 *   - manager / team-lead: Permitted employee directory/overview, tasks, schedule; restricted from SSN/banking
 *   - employee: Self-service only (can view/update own permitted profile & submit change requests)
 */

const HR_PERMISSIONS = {
  // Directory & Core Profile
  DIRECTORY_VIEW: "employee.directory.view",
  PROFILE_VIEW: "employee.profile.view",
  PROFILE_EDIT: "employee.profile.edit",
  EMPLOYMENT_EDIT: "employee.employment.edit",
  SEPARATION_MANAGE: "employee.separation.manage",

  // Sensitive & Payroll Data
  SENSITIVE_VIEW_MASKED: "employee.sensitive.view_masked",
  SENSITIVE_REVEAL: "employee.sensitive.reveal",
  COMPENSATION_VIEW: "employee.compensation.view",
  COMPENSATION_EDIT: "employee.compensation.edit",
  BANKING_EDIT: "employee.banking.edit",

  // Document Vault
  DOCUMENTS_VIEW: "employee.documents.view",
  DOCUMENTS_UPLOAD: "employee.documents.upload",
  DOCUMENTS_DOWNLOAD: "employee.documents.download",
  DOCUMENTS_DELETE: "employee.documents.delete",

  // Assets & Access
  ASSETS_VIEW: "employee.assets.view",
  ASSETS_MANAGE: "employee.assets.manage",

  // Training & Certifications
  TRAINING_VIEW: "employee.training.view",
  TRAINING_MANAGE: "employee.training.manage",

  // Timeline & History
  HISTORY_VIEW: "employee.history.view",

  // HR Notes
  HR_NOTES_VIEW: "employee.hr_notes.view",
  HR_NOTES_MANAGE: "employee.hr_notes.manage",

  // Change Requests
  CHANGE_REQUEST_SUBMIT: "employee.change_request.submit",
  CHANGE_REQUEST_REVIEW: "employee.change_request.review",
};

// Default role permission mapping
const ROLE_PERMISSIONS = {
  "super-admin": Object.values(HR_PERMISSIONS),
  admin: Object.values(HR_PERMISSIONS),
  manager: [
    HR_PERMISSIONS.DIRECTORY_VIEW,
    HR_PERMISSIONS.PROFILE_VIEW,
    HR_PERMISSIONS.SENSITIVE_VIEW_MASKED,
    HR_PERMISSIONS.DOCUMENTS_VIEW,
    HR_PERMISSIONS.ASSETS_VIEW,
    HR_PERMISSIONS.ASSETS_MANAGE,
    HR_PERMISSIONS.TRAINING_VIEW,
    HR_PERMISSIONS.TRAINING_MANAGE,
    HR_PERMISSIONS.HISTORY_VIEW,
  ],
  "team-lead": [
    HR_PERMISSIONS.DIRECTORY_VIEW,
    HR_PERMISSIONS.PROFILE_VIEW,
    HR_PERMISSIONS.DOCUMENTS_VIEW,
    HR_PERMISSIONS.ASSETS_VIEW,
    HR_PERMISSIONS.TRAINING_VIEW,
    HR_PERMISSIONS.HISTORY_VIEW,
  ],
  employee: [
    HR_PERMISSIONS.DIRECTORY_VIEW,
    HR_PERMISSIONS.CHANGE_REQUEST_SUBMIT,
  ],
  developer: [
    HR_PERMISSIONS.DIRECTORY_VIEW,
  ],
};

/**
 * Check if the user has permission to access the given employee record.
 * Evaluates: Authenticated User + Role Permission + Scope (Self / Dept / Location / All)
 */
async function canAccessEmployee(req, targetEmployeeId, requiredPermission) {
  if (!req.user) return false;

  const role = String(req.user.role || "").trim().toLowerCase();
  const userPermissions = ROLE_PERMISSIONS[role] || [];

  // Super-admin and admin have organization-wide access
  if (role === "super-admin" || role === "admin") {
    return userPermissions.includes(requiredPermission);
  }

  const actorUserId = String(req.user.sub || req.user.id || req.user._id || "");
  const targetIdStr = String(targetEmployeeId || "");

  // Check Self-access
  const isSelf = actorUserId === targetIdStr;
  if (isSelf) {
    return true;
  }

  // If role does not possess the permission key at all, deny
  if (!userPermissions.includes(requiredPermission)) {
    return false;
  }

  // For managers/team-leads: evaluate reporting hierarchy or department scope
  if (role === "manager" || role === "team-lead") {
    try {
      const target = await Employee.findById(targetEmployeeId).select("supervisorId department location").lean();
      if (!target) return false;

      // Direct report check
      if (target.supervisorId && String(target.supervisorId) === actorUserId) {
        return true;
      }

      // Department manager check
      const actorEmployee = await Employee.findById(actorUserId).select("department").lean();
      if (actorEmployee && actorEmployee.department && target.department === actorEmployee.department) {
        return true;
      }
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Middleware generator to enforce a specific HR permission key.
 */
function requireHRPermission(permissionKey) {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: { message: "Unauthorized" } });
      }

      const role = String(req.user.role || "").trim().toLowerCase();
      if (role === "super-admin" || role === "admin") {
        return next();
      }

      const targetEmployeeId = req.params.id || req.params.employeeId;
      if (targetEmployeeId) {
        const allowed = await canAccessEmployee(req, targetEmployeeId, permissionKey);
        if (!allowed) {
          return res.status(403).json({
            error: {
              message: "Forbidden: You do not have permission to perform this action on this employee record",
              requiredPermission: permissionKey,
            },
          });
        }
        return next();
      }

      // Route without specific target employee ID (e.g. queue or list)
      const userPermissions = ROLE_PERMISSIONS[role] || [];
      if (!userPermissions.includes(permissionKey)) {
        return res.status(403).json({
          error: {
            message: "Forbidden: Insufficient role permissions",
            requiredPermission: permissionKey,
          },
        });
      }

      return next();
    } catch (err) {
      console.error("[HR Permission Middleware Error]:", err);
      return res.status(500).json({ error: { message: "Internal server error" } });
    }
  };
}

module.exports = {
  HR_PERMISSIONS,
  ROLE_PERMISSIONS,
  canAccessEmployee,
  requireHRPermission,
};
