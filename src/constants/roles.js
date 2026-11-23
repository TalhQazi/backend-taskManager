// Centralized role definitions
const ROLES = Object.freeze({
  SUPER_ADMIN: "super-admin",
  ADMIN: "admin",
  MANAGER: "manager",
  EMPLOYEE: "employee",
  DEVELOPER: "developer",
});

// Role groups for access control
const ROLE_GROUPS = Object.freeze({
  // Full system access
  ALL_ADMIN: [ROLES.SUPER_ADMIN, ROLES.ADMIN],
  // Admin + management tier
  MANAGEMENT: [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.MANAGER],
  // Roles allowed to use Dropbox integration
  DROPBOX_ALLOWED: [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.MANAGER],
  // All authenticated roles
  ALL: [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE, ROLES.DEVELOPER],
});

module.exports = { ROLES, ROLE_GROUPS };
