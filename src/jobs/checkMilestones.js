const Employee = require("../models/Employee");
const Milestone = require("../models/Milestone");
const Notification = require("../models/Notification");
const { connectDb } = require("../lib/db");

// Helper function to calculate tenure in days
function calculateTenure(hireDate) {
  const hire = new Date(hireDate);
  const now = new Date();
  const diffTime = Math.abs(now - hire);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

// Helper function to determine milestone level from tenure
function getMilestoneLevel(tenureDays) {
  if (tenureDays === 30) return "30d";
  if (tenureDays === 90) return "90d";
  if (tenureDays === 180) return "6m";
  const years = Math.floor(tenureDays / 365);
  if (tenureDays === years * 365 && years >= 1 && years <= 10) return `${years}y`;
  return null;
}

// Helper function to get milestone label
function getMilestoneLabel(level) {
  const labels = {
    "30d": "30 Days Strong",
    "90d": "90 Days In",
    "6m": "6 Months In",
    "1y": "1 Year Anniversary",
    "2y": "2 Year Anniversary",
    "3y": "3 Year Anniversary",
    "4y": "4 Year Anniversary",
    "5y": "5 Year Anniversary",
    "6y": "6 Year Anniversary",
    "7y": "7 Year Anniversary",
    "8y": "8 Year Anniversary",
    "9y": "9 Year Anniversary",
    "10y": "10 Year Anniversary",
  };
  return labels[level] || "";
}

async function checkMilestones() {
  try {
    await connectDb();
    console.log("Checking for employee milestones...");

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get all active employees with hire dates
    const employees = await Employee.find({
      status: "active",
      $or: [{ joinDate: { $exists: true, $ne: null } }, { hireDate: { $exists: true, $ne: null } }],
    }).lean();

    let milestonesTriggered = 0;

    for (const employee of employees) {
      const hireDate = employee.joinDate || employee.hireDate;
      if (!hireDate) continue;

      const tenureDays = calculateTenure(hireDate);
      const milestoneLevel = getMilestoneLevel(tenureDays);

      if (!milestoneLevel) continue;

      // Check if this milestone was already triggered
      const existingMilestone = await Milestone.findOne({
        employeeId: employee._id,
        milestoneLevel,
      });

      if (existingMilestone) continue;

      // Check if we already triggered a milestone today for this employee
      if (employee.lastMilestoneTriggered) {
        const lastTriggered = new Date(employee.lastMilestoneTriggered);
        lastTriggered.setHours(0, 0, 0, 0);
        if (lastTriggered.getTime() === today.getTime()) continue;
      }

      // Trigger milestone
      const milestone = await Milestone.create({
        employeeId: employee._id,
        milestoneLevel,
        triggeredAt: new Date(),
        hireDate: new Date(hireDate),
      });

      // Update employee with milestone info
      const overlayExpires = new Date();
      overlayExpires.setHours(overlayExpires.getHours() + 24); // 24 hours

      await Employee.findByIdAndUpdate(employee._id, {
        lastMilestoneTriggered: new Date(),
        milestoneLevel,
        milestoneOverlayActive: true,
        milestoneOverlayExpires: overlayExpires,
      });

      // Create notification for the employee
      await Notification.create({
        userId: employee._id,
        title: `🎉 Milestone Achievement!`,
        message: `Congratulations! You've reached ${getMilestoneLabel(milestoneLevel)}!`,
        type: "milestone",
        metadata: {
          milestoneLevel,
          milestoneLabel: getMilestoneLabel(milestoneLevel),
        },
      });

      milestonesTriggered++;
      console.log(`✅ Milestone triggered: ${employee.name} - ${getMilestoneLabel(milestoneLevel)}`);
    }

    // Clean up expired overlays
    const expiredOverlays = await Employee.updateMany(
      {
        milestoneOverlayActive: true,
        milestoneOverlayExpires: { $lt: new Date() },
      },
      {
        milestoneOverlayActive: false,
      }
    );

    console.log(`Milestone check complete. Triggered: ${milestonesTriggered}, Expired overlays: ${expiredOverlays.modifiedCount}`);
    process.exit(0);
  } catch (err) {
    console.error("Error checking milestones:", err);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  checkMilestones();
}

module.exports = { checkMilestones };
