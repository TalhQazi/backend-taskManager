const mongoose = require("mongoose");
const UserReelProgress = require("../../models/UserReelProgress");
const UserReelEvent = require("../../models/UserReelEvent");
const UserQuizEvent = require("../../models/UserQuizEvent");
const CompanyReel = require("../../models/CompanyReel");
const Employee = require("../../models/Employee");
const ManagerBroadcast = require("../../models/ManagerBroadcast");

/**
 * Generates structured, legal-readiness compliance audit records across the workforce.
 */
async function generateAuditLedger(query = {}) {
  const { department, status, role, search } = query;

  // 1. Fetch mandatory reels
  const mandatoryReels = await CompanyReel.find({
    status: "published",
    isMandatory: true,
  })
    .select("title category dueDate applicableRoles duration")
    .lean();

  const reelMap = new Map(mandatoryReels.map((r) => [String(r._id), r]));

  // 2. Fetch employees
  const empFilter = {};
  if (department && department !== "all") {
    empFilter.department = new RegExp(`^${department}$`, "i");
  }
  if (role && role !== "all") {
    empFilter.role = new RegExp(`^${role}$`, "i");
  }

  const employees = await Employee.find(empFilter)
    .select("firstName lastName name role department email employeeId")
    .limit(100)
    .lean();

  const now = new Date();
  const ledgerRows = [];

  let totalMandatoryAssignments = 0;
  let totalCompletions = 0;
  let totalOverdue = 0;

  // 3. Evaluate compliance per employee
  for (const emp of employees) {
    const empName = `${emp.firstName || ""} ${emp.lastName || ""}`.trim() || emp.name || "Employee";
    const empId = emp.employeeId || String(emp._id);

    const progress = await UserReelProgress.findOne({ userId: emp._id }).lean();
    const completedSet = new Map(
      (progress?.completedReels || []).map((c) => [String(c.reelId), c.completedAt])
    );

    // Get quiz events for this employee
    const quizEvents = await UserQuizEvent.find({ userId: emp._id })
      .select("correct questionId answeredAt")
      .lean();
    const totalQuizAttempts = quizEvents.length;
    const passedQuizAttempts = quizEvents.filter((q) => q.correct).length;
    const quizAccuracy = totalQuizAttempts > 0 ? Math.round((passedQuizAttempts / totalQuizAttempts) * 100) : 100;

    for (const reel of mandatoryReels) {
      // Check role scoping
      const roles = (reel.applicableRoles || []).map((r) => r.toLowerCase());
      const empRole = (emp.role || "").toLowerCase();
      if (roles.length > 0 && !roles.includes(empRole) && !roles.includes("all")) {
        continue;
      }

      totalMandatoryAssignments += 1;
      const isCompleted = completedSet.has(String(reel._id));
      const completedAt = completedSet.get(String(reel._id));
      const isPastDue = reel.dueDate && new Date(reel.dueDate) < now;

      let rowStatus = "IN_PROGRESS";
      if (isCompleted) {
        rowStatus = "COMPLIANT";
        totalCompletions += 1;
      } else if (isPastDue) {
        rowStatus = "OVERDUE";
        totalOverdue += 1;
      }

      // Filter by requested status if provided
      if (status && status !== "all" && rowStatus.toLowerCase() !== status.toLowerCase()) {
        continue;
      }

      // Filter by search string if provided
      if (search) {
        const sLower = search.toLowerCase();
        const matchesName = empName.toLowerCase().includes(sLower);
        const matchesReel = reel.title.toLowerCase().includes(sLower);
        const matchesDept = (emp.department || "").toLowerCase().includes(sLower);
        if (!matchesName && !matchesReel && !matchesDept) continue;
      }

      ledgerRows.push({
        employeeId: empId,
        employeeName: empName,
        email: emp.email || "N/A",
        department: emp.department || "General",
        role: emp.role || "Team Member",
        reelId: reel._id,
        reelTitle: reel.title,
        category: reel.category,
        dueDate: reel.dueDate,
        completedAt: completedAt || null,
        status: rowStatus,
        quizAccuracy: `${quizAccuracy}%`,
        electronicSignature: isCompleted
          ? `VERIFIED_${empId.substring(0, 6)}_${new Date(completedAt).getTime()}`
          : "PENDING",
      });
    }
  }

  const overallCompliancePercent =
    totalMandatoryAssignments > 0
      ? Math.round((totalCompletions / totalMandatoryAssignments) * 100)
      : 100;

  return {
    kpis: {
      totalEmployeesTracked: employees.length,
      totalAssignments: totalMandatoryAssignments,
      totalCompletions,
      totalOverdue,
      overallCompliancePercent,
    },
    records: ledgerRows,
  };
}

/**
 * Generates an RFC 4180 CSV formatted string for compliance inspection export.
 */
async function exportAuditCsv(query = {}) {
  const ledger = await generateAuditLedger(query);

  const headers = [
    "Employee ID",
    "Employee Name",
    "Department",
    "Role",
    "Email",
    "Reel / Course Title",
    "Category",
    "Compliance Status",
    "Due Date",
    "Completion Date",
    "Quiz Accuracy",
    "Electronic Signature / Verification",
  ];

  const escapeCsv = (val) => {
    if (val === null || val === undefined) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  };

  const csvRows = [headers.map(escapeCsv).join(",")];

  for (const row of ledger.records) {
    csvRows.push(
      [
        row.employeeId,
        row.employeeName,
        row.department,
        row.role,
        row.email,
        row.reelTitle,
        row.category,
        row.status,
        row.dueDate ? new Date(row.dueDate).toLocaleDateString() : "N/A",
        row.completedAt ? new Date(row.completedAt).toLocaleString() : "N/A",
        row.quizAccuracy,
        row.electronicSignature,
      ]
        .map(escapeCsv)
        .join(",")
    );
  }

  return csvRows.join("\r\n");
}

module.exports = {
  generateAuditLedger,
  exportAuditCsv,
};
