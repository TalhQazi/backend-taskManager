const Employee = require("../models/Employee");
const EODReport = require("../models/EODReport");
const LeaveRequest = require("../models/LeaveRequest");
const Company = require("../models/Company");
const { createNotification } = require("../utils/notifications");
const { sendRawEmail } = require("../lib/email");

function getEmployeeTimezone(employee, defaultTz = "UTC") {
  const loc = (employee.location || "").toLowerCase().trim();
  if (loc.includes("pakistan") || loc === "pk") return "Asia/Karachi";
  if (loc.includes("india") || loc === "in") return "Asia/Kolkata";
  if (loc.includes("london") || loc.includes("uk") || loc === "gb") return "Europe/London";
  if (loc.includes("new york") || loc.includes("us") || loc === "usa" || loc.includes("est")) return "America/New_York";
  return defaultTz;
}

async function checkEodMissForEmployee(employee, defaultCompanyTz) {
  try {
    const tz = getEmployeeTimezone(employee, defaultCompanyTz);
    
    // Get current time parts in employee's timezone
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "numeric",
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });
    
    const parts = formatter.formatToParts(new Date());
    const hour = parseInt(parts.find(p => p.type === "hour").value, 10);
    
    // We only trigger during the 10 PM local hour (22:00 - 22:59)
    if (hour !== 22) {
      return;
    }

    const year = parts.find(p => p.type === "year").value;
    const month = parts.find(p => p.type === "month").value;
    const day = parts.find(p => p.type === "day").value;
    const localDateStr = `${year}-${month}-${day}`;

    // Check if we already sent the EOD miss alert for this local date
    const Message = require("../models/Message");
    const existingAlert = await Message.findOne({
      "meta.category": "EOD_MISS_ALERT",
      "meta.resourceId": String(employee._id),
      "meta.link": localDateStr
    });

    if (existingAlert) {
      return; // Already notified today
    }

    // Check if EOD report is submitted for this local date
    const start = new Date(`${localDateStr}T00:00:00Z`);
    const end = new Date(`${localDateStr}T23:59:59Z`);
    
    const eodReport = await EODReport.findOne({
      employeeId: employee._id,
      date: { $gte: start, $lte: end }
    });

    if (eodReport) {
      return; // Submitted
    }

    // Check if they are exempt today (on approved leave request that is exemptFromEOD: true)
    const leave = await LeaveRequest.findOne({
      employeeId: employee._id,
      status: "approved",
      exemptFromEOD: true,
      startDate: { $lte: end },
      endDate: { $gte: start }
    });

    if (leave) {
      return; // Exempt
    }

    // They missed it! Create targeted notification and email them
    const assignees = [employee.name, employee.email].filter(Boolean);
    
    await createNotification({
      actor: "System",
      actorRole: "system",
      action: "missed EOD report",
      resourceType: "report",
      resourceName: employee.name,
      details: `Missed EOD submission for date ${localDateStr}`,
      category: "EOD_MISS_ALERT",
      resourceId: String(employee._id),
      link: localDateStr, // using link as deduplication key
      assignees
    });

    // Send warning email
    if (employee.email) {
      const subject = `[REMINDER] End of Day (EOD) Report Missed`;
      const body = `Dear ${employee.name},\n\n` +
        `This is a reminder that we have not received your End of Day (EOD) report for today (${localDateStr}). EOD reports are due by 10 PM local time.\n\n` +
        `Please log in to the Task Manager application as soon as possible and submit your EOD report.\n\n` +
        `Thank you,\nManagement`;
      
      await sendRawEmail({
        to: employee.email,
        subject,
        body
      });
    }

    console.log(`[EOD miss alert] Dispatched successfully for employee: ${employee.name} (Tz: ${tz}, Local Date: ${localDateStr})`);

  } catch (err) {
    console.error(`Error in checkEodMissForEmployee for ${employee.name}:`, err);
  }
}

async function run() {
  try {
    const activeEmployees = await Employee.find({
      status: "active",
      userRole: { $ne: "super-admin" }
    });
    if (!activeEmployees.length) return;

    const company = await Company.findOne();
    const defaultCompanyTz = company?.timezone || "UTC";

    for (const employee of activeEmployees) {
      await checkEodMissForEmployee(employee, defaultCompanyTz);
    }
  } catch (err) {
    console.error("Error in EOD Miss background job:", err);
  }
}

module.exports = { run };
