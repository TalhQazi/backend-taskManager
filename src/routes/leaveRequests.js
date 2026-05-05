const express = require("express");
const LeaveRequest = require("../models/LeaveRequest");
const { requireAuth } = require("../middleware/auth");
const User = require("../models/User");
const Employee = require("../models/Employee");

const router = express.Router();

async function resolveEmployeeNameFromAuth(req) {
  const userId = String(req.user?.sub || req.user?.id || "").trim();
  if (!userId) return "";
  const user = await User.findById(userId, { name: 1, username: 1, email: 1 }).lean();
  const email = String(user?.email || "").trim();
  if (email) {
    const emp = await Employee.findOne({ email }, { name: 1 }).lean();
    return String(emp?.name || user?.name || user?.username || "").trim();
  }
  return String(user?.name || user?.username || "").trim();
}

// GET /api/leave-requests/all - Get all leave requests (manager/admin view)
router.get("/all", requireAuth, async (req, res, next) => {
  try {
    const items = await LeaveRequest.find().sort({ createdAt: -1 }).lean();
    return res.json({
      items: items.map((i) => ({
        id: String(i._id),
        employeeName: i.employeeName || "",
        type: i.type || "",
        startDate: i.startDate || "",
        endDate: i.endDate || "",
        status: i.status || "pending",
        reason: i.reason || "",
        exemptFromEOD: Boolean(i.exemptFromEOD),
        approvedAt: i.approvedAt ? i.approvedAt.toISOString() : undefined,
        approvedBy: i.approvedBy || undefined,
        createdAt: i.createdAt ? i.createdAt.toISOString() : undefined,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/leave-requests/me - Get current employee's leave requests
router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const name = await resolveEmployeeNameFromAuth(req);
    if (!name) return res.json({ items: [] });

    const items = await LeaveRequest.find({ employeeName: name }).sort({ createdAt: -1 }).lean();
    return res.json({
      items: items.map((i) => ({
        id: String(i._id),
        employeeName: i.employeeName || "",
        type: i.type || "",
        startDate: i.startDate || "",
        endDate: i.endDate || "",
        status: i.status || "pending",
        reason: i.reason || "",
        exemptFromEOD: Boolean(i.exemptFromEOD),
        createdAt: i.createdAt ? i.createdAt.toISOString() : undefined,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/leave-requests - Create a new leave request (employee)
router.post("/", requireAuth, async (req, res, next) => {
  try {
    const { employeeName, type, startDate, endDate, reason, exemptFromEOD } = req.body;

    let name = String(employeeName || "").trim();
    if (!name) {
      name = await resolveEmployeeNameFromAuth(req);
    }

    const leaveType = String(type || "").trim();
    const start = String(startDate || "").trim();
    const end = String(endDate || "").trim();
    if (!name) return res.status(400).json({ error: { message: "employeeName is required" } });
    if (!leaveType) return res.status(400).json({ error: { message: "type is required" } });
    if (!start) return res.status(400).json({ error: { message: "startDate is required" } });
    if (!end) return res.status(400).json({ error: { message: "endDate is required" } });

    const created = await LeaveRequest.create({
      employeeName: name,
      type: leaveType,
      startDate: start,
      endDate: end,
      reason: String(reason || "").trim(),
      exemptFromEOD: Boolean(exemptFromEOD),
      status: "pending",
    });
    return res.status(201).json({
      item: {
        id: String(created._id),
        employeeName: created.employeeName,
        type: created.type,
        startDate: created.startDate,
        endDate: created.endDate,
        status: created.status,
        reason: created.reason,
        exemptFromEOD: created.exemptFromEOD,
        createdAt: created.createdAt ? created.createdAt.toISOString() : undefined,
      },
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/leave-requests/:id/status - Update leave request status (admin/manager)
router.patch("/:id/status", requireAuth, async (req, res, next) => {
  try {
    const { status, approvedBy } = req.body;
    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({ error: { message: "Invalid status" } });
    }
    const updated = await LeaveRequest.findByIdAndUpdate(
      req.params.id,
      {
        status,
        approvedAt: new Date(),
        approvedBy: String(approvedBy || "").trim(),
      },
      { new: true }
    ).lean();
    if (!updated) {
      return res.status(404).json({ error: { message: "Leave request not found" } });
    }
    return res.json({
      item: {
        id: String(updated._id),
        employeeName: updated.employeeName,
        type: updated.type,
        startDate: updated.startDate,
        endDate: updated.endDate,
        status: updated.status,
        reason: updated.reason,
        exemptFromEOD: updated.exemptFromEOD,
        approvedAt: updated.approvedAt ? updated.approvedAt.toISOString() : undefined,
        approvedBy: updated.approvedBy || undefined,
      },
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/leave-requests/:id - Employee can delete their own pending request
router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const name = await resolveEmployeeNameFromAuth(req);
    if (!name) return res.status(401).json({ error: { message: "Unauthorized" } });

    const doc = await LeaveRequest.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ error: { message: "Leave request not found" } });

    if (String(doc.employeeName || "").trim() !== name) {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }
    if (String(doc.status || "pending") !== "pending") {
      return res.status(400).json({ error: { message: "Only pending requests can be deleted" } });
    }

    await LeaveRequest.findByIdAndDelete(req.params.id);
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
