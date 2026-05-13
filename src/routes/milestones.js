const express = require("express");
const { z } = require("zod");
const Employee = require("../models/Employee");
const Milestone = require("../models/Milestone");
const Notification = require("../models/Notification");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

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
  if (tenureDays >= 30 && tenureDays < 90) return "30d";
  if (tenureDays >= 90 && tenureDays < 180) return "90d";
  if (tenureDays >= 180 && tenureDays < 365) return "6m";
  const years = Math.floor(tenureDays / 365);
  if (years >= 1 && years <= 10) return `${years}y`;
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

// GET /api/milestones/today - Get all employees hitting milestones today
router.get("/today", requireAuth, async (req, res, next) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Find milestones triggered today
    const milestonesToday = await Milestone.find({
      triggeredAt: { $gte: today, $lt: tomorrow },
    })
      .populate("employeeId", "name email avatarUrl")
      .sort({ triggeredAt: -1 })
      .lean();

    const items = milestonesToday.map((m) => ({
      id: String(m._id),
      employeeId: String(m.employeeId._id),
      employeeName: m.employeeId.name,
      employeeEmail: m.employeeId.email,
      milestoneLevel: m.milestoneLevel,
      milestoneLabel: getMilestoneLabel(m.milestoneLevel),
      triggeredAt: m.triggeredAt,
      acknowledged: m.acknowledged,
    }));

    res.json({ items });
  } catch (err) {
    next(err);
  }
});

// GET /api/milestones/user/:id - Get milestone info for a specific user
router.get("/user/:id", requireAuth, async (req, res, next) => {
  try {
    const employeeId = req.params.id;
    const employee = await Employee.findById(employeeId).lean();

    if (!employee) {
      return res.status(404).json({ error: { message: "Employee not found" } });
    }

    const hireDate = employee.joinDate || employee.hireDate;
    if (!hireDate) {
      return res.json({ item: null });
    }

    const tenureDays = calculateTenure(hireDate);
    const currentMilestoneLevel = getMilestoneLevel(tenureDays);

    // Get latest milestone
    const latestMilestone = await Milestone.findOne({ employeeId })
      .sort({ triggeredAt: -1 })
      .lean();

    // Check if overlay is active
    const overlayActive = employee.milestoneOverlayActive && 
      employee.milestoneOverlayExpires && 
      new Date(employee.milestoneOverlayExpires) > new Date();

    // Update employee with milestone info
    const overlayExpires = new Date();
    overlayExpires.setHours(overlayExpires.getHours() + 24); // 24 hours

    await Employee.findByIdAndUpdate(employee._id, {
      lastMilestoneTriggered: new Date(),
      milestoneLevel: currentMilestoneLevel,
      milestoneOverlayActive: true,
      milestoneOverlayExpires: overlayExpires,
    });

    // Create notification for the employee
    await Notification.create({
      userId: employee._id,
      title: `🎉 Milestone Achievement!`,
      message: `Congratulations! You've reached ${getMilestoneLabel(currentMilestoneLevel)}!`,
      type: "milestone",
      metadata: {
        milestoneLevel: currentMilestoneLevel,
        milestoneLabel: getMilestoneLabel(currentMilestoneLevel),
      },
    });

    res.json({
      item: {
        employeeId: String(employee._id),
        hireDate: hireDate,
        tenureDays,
        currentMilestoneLevel,
        currentMilestoneLabel: currentMilestoneLevel ? getMilestoneLabel(currentMilestoneLevel) : "",
        lastMilestoneTriggered: employee.lastMilestoneTriggered,
        milestoneLevel: employee.milestoneLevel,
        overlayActive,
        overlayExpires: employee.milestoneOverlayExpires,
        latestMilestone: latestMilestone ? {
          id: String(latestMilestone._id),
          milestoneLevel: latestMilestone.milestoneLevel,
          milestoneLabel: getMilestoneLabel(latestMilestone.milestoneLevel),
          triggeredAt: latestMilestone.triggeredAt,
          acknowledged: latestMilestone.acknowledged,
        } : null,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/milestones/user/:id/tenure - Get tenure info for a user
router.get("/user/:id/tenure", requireAuth, async (req, res, next) => {
  try {
    const employeeId = req.params.id;
    const employee = await Employee.findById(employeeId).lean();

    if (!employee) {
      return res.status(404).json({ error: { message: "Employee not found" } });
    }

    const hireDate = employee.joinDate || employee.hireDate;
    if (!hireDate) {
      return res.json({ item: null });
    }

    const tenureDays = calculateTenure(hireDate);
    const years = Math.floor(tenureDays / 365);
    const months = Math.floor((tenureDays % 365) / 30);
    const days = tenureDays % 30;

    res.json({
      item: {
        employeeId: String(employee._id),
        hireDate: hireDate,
        tenureDays,
        years,
        months,
        days,
        formatted: `${years > 0 ? years + "y " : ""}${months > 0 ? months + "m " : ""}${days}d`,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/milestones/message/send - Send a congratulatory message
const messageSchema = z.object({
  recipientId: z.string(),
  message: z.string().min(1).max(500),
  template: z.string().optional(),
});

router.post("/message/send", requireAuth, async (req, res, next) => {
  try {
    const parsed = messageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload" } });
    }

    const { recipientId, message, template } = parsed.data;
    const senderId = String(req.user?.sub || "");

    // Increment message count for the milestone
    const latestMilestone = await Milestone.findOne({ employeeId: recipientId })
      .sort({ triggeredAt: -1 });

    if (latestMilestone) {
      await Milestone.findByIdAndUpdate(latestMilestone._id, {
        $inc: { messagesSent: 1 },
      });
    }

    // TODO: Integrate with messaging system to actually send the message
    // For now, just return success
    res.json({ 
      ok: true, 
      message: "Message sent successfully",
      data: {
        recipientId,
        senderId,
        message,
        template,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
