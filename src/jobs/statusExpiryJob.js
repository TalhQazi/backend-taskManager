const Employee = require("../models/Employee");
const ActivityLog = require("../models/ActivityLog");
const { cacheDel } = require("../lib/cache");
const { createNotification } = require("../utils/notifications");
const { sendEmailNotification } = require("../utils/emailNotifications");

async function notifyAutoExpire(employee, statusType, exceededMinutes) {
  try {
    const statusLabel = statusType === "LUNCH" ? "lunch" : "break";
    const statusUpdate = `Exceeded ${statusLabel} limit (auto-expired)`;

    await createNotification({
      actor: employee.name,
      actorRole: "employee",
      action: `exceeded ${statusLabel} limit (auto-expired)`,
      resourceType: "status",
      resourceName: employee.name,
      details: `overdue by ${exceededMinutes} minute(s)`,
      category: "LUNCH_BREAK_ALERT",
    });

    const EmployeeModel = require("../models/Employee");
    const activeStaff = await EmployeeModel.find({
      status: "active",
      userRole: { $in: ["super-admin", "admin", "manager"] }
    }).select("email").lean();

    const timeStr = new Date().toLocaleString();
    for (const staff of activeStaff) {
      if (staff.email) {
        await sendEmailNotification(staff.email, "lunchBreakAlert", {
          employeeName: employee.name,
          statusUpdate: `${statusUpdate} (overdue by ${exceededMinutes} mins)`,
          time: timeStr,
        });
      }
    }
  } catch (err) {
    console.error(`Failed to send auto-expire ${statusType} notifications:`, err);
  }
}

async function checkStatusExpiry() {
  try {
    const now = new Date();
    
    // 1. Check Lunch status auto-expiry (30 minutes)
    const lunchLimitPassed = await Employee.find({
      current_status: "LUNCH",
      lunch_expected_end: { $ne: null, $lt: now }
    });

    for (const employee of lunchLimitPassed) {
      const oldStartTime = employee.lunch_start_time;
      const oldExpectedEnd = employee.lunch_expected_end;
      const exceededMs = now.getTime() - oldExpectedEnd.getTime();
      const exceededMinutes = Math.round(exceededMs / (60 * 1000));

      employee.current_status = "AVAILABLE";
      employee.lunch_start_time = null;
      employee.lunch_expected_end = null;
      employee.break_start_time = null;

      await employee.save();
      await cacheDel("employees:list");

      if (global.io) {
        global.io.emit("status-update", {
          userId: String(employee._id),
          current_status: "AVAILABLE",
          lunch_start_time: null,
          lunch_expected_end: null,
          break_start_time: null,
          name: employee.name,
        });
      }

      // Log HR activity log for auto-expired lunch
      await ActivityLog.create({
        actorUserId: "system",
        actorUsername: "System Scheduler",
        actorRole: "system",
        action: "auto_expire",
        resourceType: "employee",
        resourceId: String(employee._id),
        resourceName: employee.name,
        description: `SYSTEM AUTO-EXPIRED: ${employee.name} exceeded lunch limit (30 mins). Automatically reset to AVAILABLE.`,
        ipAddress: "127.0.0.1",
        userAgent: "System",
        metadata: {
          autoExpired: true,
          statusType: "LUNCH",
          exceededMinutes,
          lunch_start_time: oldStartTime,
          lunch_expected_end: oldExpectedEnd,
        }
      });

      // Also log a late return since they returned late
      await ActivityLog.create({
        actorUserId: "system",
        actorUsername: "System Scheduler",
        actorRole: "system",
        action: "late_return",
        resourceType: "employee",
        resourceId: String(employee._id),
        resourceName: employee.name,
        description: `LATE RETURN (AUTO-EXPIRED): ${employee.name} exceeded lunch limit. Overdue by ${exceededMinutes} minute(s).`,
        ipAddress: "127.0.0.1",
        userAgent: "System",
        metadata: {
          isLateReturn: true,
          autoExpired: true,
          statusType: "LUNCH",
          exceededMinutes,
          lunch_start_time: oldStartTime,
          lunch_expected_end: oldExpectedEnd,
        }
      });
      void notifyAutoExpire(employee, "LUNCH", exceededMinutes);

      console.log(`[Status Expiry] Auto-expired lunch status for employee: ${employee.name} (exceeded by ${exceededMinutes}m)`);
    }

    // 2. Check Break status auto-expiry (15 minutes limit)
    // Find all active employees with break status
    const breakActive = await Employee.find({
      current_status: "BREAK",
      break_start_time: { $ne: null }
    });

    for (const employee of breakActive) {
      const oldStartTime = employee.break_start_time;
      const expectedEnd = new Date(oldStartTime.getTime() + 15 * 60 * 1000); // 15 mins limit
      
      if (now > expectedEnd) {
        const exceededMs = now.getTime() - expectedEnd.getTime();
        const exceededMinutes = Math.round(exceededMs / (60 * 1000));

        employee.current_status = "AVAILABLE";
        employee.lunch_start_time = null;
        employee.lunch_expected_end = null;
        employee.break_start_time = null;

        await employee.save();
        await cacheDel("employees:list");

        if (global.io) {
          global.io.emit("status-update", {
            userId: String(employee._id),
            current_status: "AVAILABLE",
            lunch_start_time: null,
            lunch_expected_end: null,
            break_start_time: null,
            name: employee.name,
          });
        }

        // Log HR activity log for auto-expired break
        await ActivityLog.create({
          actorUserId: "system",
          actorUsername: "System Scheduler",
          actorRole: "system",
          action: "auto_expire",
          resourceType: "employee",
          resourceId: String(employee._id),
          resourceName: employee.name,
          description: `SYSTEM AUTO-EXPIRED: ${employee.name} exceeded break limit (15 mins). Automatically reset to AVAILABLE.`,
          ipAddress: "127.0.0.1",
          userAgent: "System",
          metadata: {
            autoExpired: true,
            statusType: "BREAK",
            exceededMinutes,
            break_start_time: oldStartTime,
          }
        });

        // Also log a late return since they returned late
        await ActivityLog.create({
          actorUserId: "system",
          actorUsername: "System Scheduler",
          actorRole: "system",
          action: "late_return",
          resourceType: "employee",
          resourceId: String(employee._id),
          resourceName: employee.name,
          description: `LATE RETURN (AUTO-EXPIRED): ${employee.name} exceeded break limit. Overdue by ${exceededMinutes} minute(s).`,
          ipAddress: "127.0.0.1",
          userAgent: "System",
          metadata: {
            isLateReturn: true,
            autoExpired: true,
            statusType: "BREAK",
            exceededMinutes,
            break_start_time: oldStartTime,
          }
        });
        await notifyAutoExpire(employee, "BREAK", exceededMinutes);

        console.log(`[Status Expiry] Auto-expired break status for employee: ${employee.name} (exceeded by ${exceededMinutes}m)`);
      }
    }
  } catch (err) {
    console.error("[Status Expiry] Error running status check:", err);
  }
}

module.exports = { checkStatusExpiry };
