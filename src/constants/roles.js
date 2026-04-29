const ROLES = {
  SUPER_ADMIN: "super-admin",
  ADMIN: "admin",
  MANAGER: "manager",
  PAYROLL: "payroll",
  DEVELOPER: "developer",
  EMPLOYEE: "employee",
};

const ROLE_GROUPS = {
  ALL_MANAGEMENT: [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.MANAGER],
  ADMIN_ONLY: [ROLES.SUPER_ADMIN, ROLES.ADMIN],
  SUPER_ADMIN_ONLY: [ROLES.SUPER_ADMIN],
};

module.exports = {
  ROLES,
  ROLE_GROUPS,
};
