const EODReport = require("../models/EODReport");
const EODFlag = require("../models/EODFlag");
const WorkSchedule = require("../models/WorkSchedule");
const User = require("../models/User");
const LeaveRequest = require("../models/LeaveRequest");
const { createNotification } = require("../utils/notifications");

/**
 * Generate weekly compliance report
 * Runs every Monday at 9 AM
 */
async function generateWeeklyComplianceReport() {
  const now = new Date();
  
  // Only run on Mondays at 9 AM
  if (now.getDay() !== 1 || now.getHours() !== 9) {
    return { skipped: true, reason: "Not Monday 9 AM" };
  }

  console.log("[WeeklyCompliance] Generating weekly report...");

  // Calculate previous week range (Monday to Sunday)
  const weekEnd = new Date(now);
  weekEnd.setDate(weekEnd.getDate() - 1); // Sunday
  weekEnd.setHours(23, 59, 59, 999);
  
  const weekStart = new Date(weekEnd);
  weekStart.setDate(weekStart.getDate() - 6); // Monday
  weekStart.setHours(0, 0, 0, 0);

  try {
    // Get all active employees with schedules
    const schedules = await WorkSchedule.find({ isActive: true }).lean();
    const userIds = [...new Set(schedules.map(s => String(s.userId)))];

    const reportData = [];

    for (const userId of userIds) {
      const user = await User.findById(userId).select("name email username").lean();
      if (!user) continue;

      // Count working days (excluding weekends and approved leave)
      let workingDays = 0;
      let submittedCount = 0;
      let lateCount = 0;
      let missingCount = 0;
      let leaveDays = 0;

      for (let d = new Date(weekStart); d <= weekEnd; d.setDate(d.getDate() + 1)) {
        // Skip weekends
        if (d.getDay() === 0 || d.getDay() === 6) continue;

        // Check if on approved leave
        const isOnLeave = await LeaveRequest.isUserOnLeave(userId, d);
        if (isOnLeave) {
          leaveDays++;
          continue;
        }

        workingDays++;

        // Check EOD status for this day
        const dayStart = new Date(d);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(d);
        dayEnd.setHours(23, 59, 59, 999);

        const eodReport = await EODReport.findOne({
          userId,
          date: { $gte: dayStart, $lte: dayEnd },
        }).lean();

        if (eodReport) {
          if (eodReport.status === "submitted") {
            submittedCount++;
          } else if (eodReport.status === "late") {
            lateCount++;
          }
        } else {
          // Check for missing flag
          const flag = await EODFlag.findOne({
            userId,
            date: { $gte: dayStart, $lte: dayEnd },
            status: "missing",
          }).lean();

          if (flag) {
            missingCount++;
          } else {
            missingCount++; // Count as missing if no report and no flag
          }
        }
      }

      // Calculate compliance rate
      const complianceRate = workingDays > 0 
        ? Math.round((submittedCount / workingDays) * 100) 
        : 0;

      reportData.push({
        userId,
        employeeName: user.name || user.username || "Unknown",
        email: user.email,
        workingDays,
        leaveDays,
        submitted: submittedCount,
        late: lateCount,
        missing: missingCount,
        complianceRate,
        status: complianceRate >= 90 ? "excellent" : complianceRate >= 70 ? "good" : complianceRate >= 50 ? "needs_improvement" : "poor",
      });
    }

    // Sort by compliance rate (lowest first - needs attention)
    reportData.sort((a, b) => a.complianceRate - b.complianceRate);

    // Notify managers
    const managers = await User.find({
      role: { $in: ["manager", "admin", "super-admin"] },
      status: "active",
    }).select("_id name email").lean();

    const summary = {
      weekStart: weekStart.toISOString().split("T")[0],
      weekEnd: weekEnd.toISOString().split("T")[0],
      totalEmployees: reportData.length,
      avgCompliance: reportData.length > 0 
        ? Math.round(reportData.reduce((sum, r) => sum + r.complianceRate, 0) / reportData.length)
        : 0,
      excellentCount: reportData.filter(r => r.status === "excellent").length,
      goodCount: reportData.filter(r => r.status === "good").length,
      needsImprovementCount: reportData.filter(r => r.status === "needs_improvement").length,
      poorCount: reportData.filter(r => r.status === "poor").length,
      poorPerformers: reportData.filter(r => r.status === "poor").map(r => ({
        name: r.employeeName,
        rate: r.complianceRate,
      })),
    };

    // Create notification for each manager
    for (const manager of managers) {
      await createNotification({
        actor: "system",
        actorRole: "system",
        action: "weekly_compliance_report",
        resourceType: "EOD compliance",
        resourceName: `Week of ${summary.weekStart} - ${summary.weekEnd}`,
        assignees: [String(manager._id)],
        details: `Weekly EOD Compliance: ${summary.avgCompliance}% average. ${summary.poorCount} employees need attention.`,
        resourceId: "",
      });
    }

    console.log("[WeeklyCompliance] Report generated:", summary);

    return {
      success: true,
      summary,
      employeeDetails: reportData,
      generatedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error("[WeeklyCompliance] Error generating report:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Run weekly compliance check (to be called from scheduler)
 */
async function runWeeklyComplianceCheck() {
  const result = await generateWeeklyComplianceReport();
  return result;
}

module.exports = {
  generateWeeklyComplianceReport,
  runWeeklyComplianceCheck,
};
