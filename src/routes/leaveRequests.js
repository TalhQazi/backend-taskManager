const express = require("express");
const { z } = require("zod");

const LeaveRequest = require("../models/LeaveRequest");
const Employee = require("../models/Employee");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

const createSchema = z.object({
  type: z.enum(["pto", "vacation", "sick", "holiday", "unpaid", "other"]).default("pto"),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  reason: z.string().optional().default(""),
  exemptFromEOD: z.boolean().optional().default(false),
});

function toItem(doc) {
  return {
    id: String(doc._id),
    employeeName: String(doc.employeeName || ""),
    type: String(doc.type || "other"),
    startDate: doc.startDate ? new Date(doc.startDate).toISOString().slice(0, 10) : "",
    endDate: doc.endDate ? new Date(doc.endDate).toISOString().slice(0, 10) : "",
    status: String(doc.status || "pending"),
    reason: String(doc.reason || ""),
    exemptFromEOD: Boolean(doc.exemptFromEOD),
    approvedAt: doc.approvedAt || null,
    approvedBy: String(doc.approvedBy || ""),
    createdAt: doc.createdAt || null,
  };
}

async function requireEmployeeSelf(req, res) {
  const role = String(req.user?.role || "").trim().toLowerCase();
  const allowedRoles = new Set(["employee", "manager", "team-lead"]);
  if (!allowedRoles.has(role)) {
    res.status(403).json({ error: { message: "Forbidden" } });
    return null;
  }

  const userId = String(req.user?.sub || "").trim();
  const username = String(req.user?.username || "").trim();
  const name = String(req.user?.name || "").trim();
  const normalizedCandidates = [username, name].map((v) => v.toLowerCase()).filter(Boolean);

  let employee = await Employee.findById(userId).lean();

  if (!employee && normalizedCandidates.length > 0) {
    const regexes = normalizedCandidates.map((c) => new RegExp(`^${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"));
    employee = await Employee.findOne({
      $or: [{ email: { $in: regexes } }, { name: { $in: regexes } }],
    }).lean();
  }

  if (!employee) {
    res.status(404).json({ error: { message: "Employee not found" } });
    return null;
  }

  return { employee };
}

router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeSelf(req, res);
    if (!ctx) return;

    const items = await LeaveRequest.find({ employeeId: ctx.employee._id }).sort({ createdAt: -1 }).lean();
    res.json({ items: items.map(toItem) });
  } catch (err) {
    next(err);
  }
});

router.post("/", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeSelf(req, res);
    if (!ctx) return;

    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload" } });
    }

    const startDate = new Date(parsed.data.startDate);
    const endDate = new Date(parsed.data.endDate);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return res.status(400).json({ error: { message: "Invalid dates" } });
    }
    if (endDate < startDate) {
      return res.status(400).json({ error: { message: "End date cannot be before start date" } });
    }

    const created = await LeaveRequest.create({
      employeeId: ctx.employee._id,
      employeeName: ctx.employee.name || "",
      type: parsed.data.type,
      startDate,
      endDate,
      reason: parsed.data.reason || "",
      exemptFromEOD: Boolean(parsed.data.exemptFromEOD),
      status: "pending",
    });

    return res.status(201).json({ item: toItem(created) });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeSelf(req, res);
    if (!ctx) return;

    const item = await LeaveRequest.findById(req.params.id);
    if (!item) {
      return res.status(404).json({ error: { message: "Leave request not found" } });
    }
    if (String(item.employeeId) !== String(ctx.employee._id)) {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }
    if (item.status !== "pending") {
      return res.status(400).json({ error: { message: "Only pending requests can be deleted" } });
    }

    await LeaveRequest.deleteOne({ _id: item._id });
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.get("/all", requireAuth, requireRole(["admin", "super-admin", "manager"]), async (_req, res, next) => {
  try {
    const items = await LeaveRequest.find({}).sort({ createdAt: -1 }).lean();
    res.json({ items: items.map(toItem) });
  } catch (err) {
    next(err);
  }
});

router.put("/:id/approve", requireAuth, requireRole(["admin", "super-admin"]), async (req, res, next) => {
  try {
    const updated = await LeaveRequest.findByIdAndUpdate(
      req.params.id,
      {
        status: "approved",
        approvedAt: new Date(),
        approvedBy: String(req.user?.username || req.user?.name || "admin"),
        rejectedAt: null,
        rejectedBy: "",
        rejectionReason: "",
      },
      { new: true }
    ).lean();

    if (!updated) {
      return res.status(404).json({ error: { message: "Leave request not found" } });
    }

    return res.json({ item: toItem(updated) });
  } catch (err) {
    next(err);
  }
});

router.put("/:id/reject", requireAuth, requireRole(["admin", "super-admin"]), async (req, res, next) => {
  try {
    const reason = String(req.body?.reason || "").trim();
    const updated = await LeaveRequest.findByIdAndUpdate(
      req.params.id,
      {
        status: "rejected",
        rejectedAt: new Date(),
        rejectedBy: String(req.user?.username || req.user?.name || "admin"),
        rejectionReason: reason,
      },
      { new: true }
    ).lean();

    if (!updated) {
      return res.status(404).json({ error: { message: "Leave request not found" } });
    }

    return res.json({ item: toItem(updated) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
