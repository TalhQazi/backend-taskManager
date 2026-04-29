const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const LeaveRequest = require("../models/LeaveRequest");
const { requireAuth, requireRole } = require("../middleware/auth");

// GET /api/leave-requests/me - Get current user's leave requests
router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const userIdRaw = req.user?._id || req.user?.sub;
    if (!userIdRaw) {
      return res.status(401).json({ error: { message: "Unauthorized" } });
    }
    const userId = new mongoose.Types.ObjectId(String(userIdRaw));
    const items = await LeaveRequest.find({ userId })
      .sort({ createdAt: -1 })
      .lean();
    return res.json({ items });
  } catch (err) {
    next(err);
  }
});

// POST /api/leave-requests - Create leave request (employee)
router.post("/", requireAuth, async (req, res, next) => {
  try {
    const userIdRaw = req.user?._id || req.user?.sub;
    if (!userIdRaw) {
      return res.status(401).json({ error: { message: "Unauthorized" } });
    }
    const userId = new mongoose.Types.ObjectId(String(userIdRaw));
    const { type, startDate, endDate, reason, exemptFromEOD } = req.body;

    // Validation
    if (!type || !startDate || !endDate) {
      return res.status(400).json({ message: "Type, startDate, and endDate are required" });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (start > end) {
      return res.status(400).json({ message: "Start date cannot be after end date" });
    }

    // Get employee info
    const Employee = require("../models/Employee");
    const employee = await Employee.findOne({ email: req.user.email }).lean();

    const leaveRequest = await LeaveRequest.create({
      userId,
      employeeId: employee?._id || userId,
      employeeName: employee?.name || req.user.name || req.user.username,
      type,
      startDate: start,
      endDate: end,
      reason,
      exemptFromEOD: exemptFromEOD !== false, // Default true
      status: "pending",
    });

    return res.status(201).json({ item: leaveRequest });
  } catch (err) {
    next(err);
  }
});

// GET /api/leave-requests/pending - Get pending requests (manager/admin)
router.get("/pending", requireAuth, requireRole(["manager", "admin", "super-admin"]), async (req, res, next) => {
  try {
    const items = await LeaveRequest.find({ status: "pending" })
      .sort({ createdAt: -1 })
      .lean();
    return res.json({ items });
  } catch (err) {
    next(err);
  }
});

// GET /api/leave-requests/all - Get all requests (manager/admin)
router.get("/all", requireAuth, requireRole(["manager", "admin", "super-admin"]), async (req, res, next) => {
  try {
    const { status, type, userId } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (type) filter.type = type;
    if (userId) filter.userId = userId;

    const items = await LeaveRequest.find(filter)
      .sort({ createdAt: -1 })
      .lean();
    return res.json({ items });
  } catch (err) {
    next(err);
  }
});

// PUT /api/leave-requests/:id/approve - Approve leave request
router.put("/:id/approve", requireAuth, requireRole(["manager", "admin", "super-admin"]), async (req, res, next) => {
  try {
    const { id } = req.params;
    const approverIdRaw = req.user?._id || req.user?.sub;
    if (!approverIdRaw) {
      return res.status(401).json({ error: { message: "Unauthorized" } });
    }
    const approverId = new mongoose.Types.ObjectId(String(approverIdRaw));
    const request = await LeaveRequest.findByIdAndUpdate(
      id,
      {
        status: "approved",
        approvedBy: approverId,
        approvedAt: new Date(),
      },
      { new: true }
    ).lean();

    if (!request) {
      return res.status(404).json({ message: "Leave request not found" });
    }

    return res.json({ item: request });
  } catch (err) {
    next(err);
  }
});

// PUT /api/leave-requests/:id/reject - Reject leave request
router.put("/:id/reject", requireAuth, requireRole(["manager", "admin", "super-admin"]), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const approverIdRaw = req.user?._id || req.user?.sub;
    if (!approverIdRaw) {
      return res.status(401).json({ error: { message: "Unauthorized" } });
    }
    const approverId = new mongoose.Types.ObjectId(String(approverIdRaw));

    const request = await LeaveRequest.findByIdAndUpdate(
      id,
      {
        status: "rejected",
        approvedBy: approverId,
        approvedAt: new Date(),
        reason: reason || "Request rejected",
      },
      { new: true }
    ).lean();

    if (!request) {
      return res.status(404).json({ message: "Leave request not found" });
    }

    return res.json({ item: request });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/leave-requests/:id - Delete leave request
router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const request = await LeaveRequest.findById(id).lean();

    if (!request) {
      return res.status(404).json({ message: "Leave request not found" });
    }

    const actorIdRaw = req.user?._id || req.user?.sub;
    if (!actorIdRaw) {
      return res.status(401).json({ error: { message: "Unauthorized" } });
    }

    // Only allow delete if user owns it or is admin
    if (String(request.userId) !== String(actorIdRaw) && 
        !["admin", "super-admin"].includes(req.user.role)) {
      return res.status(403).json({ message: "Not authorized to delete this request" });
    }

    // Only allow delete if still pending
    if (request.status !== "pending") {
      return res.status(400).json({ message: "Cannot delete approved/rejected requests" });
    }

    await LeaveRequest.findByIdAndDelete(id);
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/leave-requests/check/:userId - Check if user is on leave today
router.get("/check/:userId", requireAuth, requireRole(["manager", "admin", "super-admin"]), async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { date } = req.query;
    const checkDate = date ? new Date(date) : new Date();

    const isOnLeave = await LeaveRequest.isUserOnLeave(userId, checkDate);
    return res.json({ isOnLeave });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
