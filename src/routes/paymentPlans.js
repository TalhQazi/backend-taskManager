const express = require("express");
const mongoose = require("mongoose");
const { z } = require("zod");

const PaymentPlan = require("../models/PaymentPlan");
const PaymentSchedule = require("../models/PaymentSchedule");
const Tenant = require("../models/Tenant");
const Company = require("../models/Company");

const { requireAuth, requireRole } = require("../middleware/auth");
const { createNotification } = require("../utils/notifications");

const router = express.Router();

const numberFromAny = z.preprocess((v) => {
  if (v === "" || v === null || v === undefined) return v;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : v;
  }
  return v;
}, z.number());

const positiveNumberFromAny = z.preprocess((v) => {
  if (v === "" || v === null || v === undefined) return v;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : v;
  }
  return v;
}, z.number().positive());

const scheduleItemSchema = z.object({
  paymentNumber: z.number().int().min(1),
  dueDate: z.string().min(1),
  dueTime: z.string().optional().default(""),
  amount: positiveNumberFromAny,
});

const createPlanSchema = z.object({
  tenantId: z.string().min(1),
  propertyId: z.string().min(1),
  totalBalance: positiveNumberFromAny,
  agreementNotes: z.string().optional().default(""),
  status: z.enum(["draft", "active", "completed", "defaulted"]).optional().default("draft"),
  schedule: z.array(scheduleItemSchema).min(1),
});

const updatePlanSchema = createPlanSchema
  .omit({ schedule: true })
  .partial()
  .extend({ schedule: z.array(scheduleItemSchema).optional() });

function isPastDate(dueDateStr) {
  const due = new Date(dueDateStr);
  if (Number.isNaN(due.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  return due < today;
}

async function recomputePlanBalances(planId) {
  const [plan, schedule] = await Promise.all([
    PaymentPlan.findById(planId),
    PaymentSchedule.find({ planId }).lean(),
  ]);
  if (!plan) return null;

  const paidTotal = schedule
    .filter((s) => s.status === "paid")
    .reduce((acc, s) => acc + (Number(s.amount) || 0), 0);

  const remaining = Math.max(0, Number(plan.totalBalance || 0) - paidTotal);

  let nextStatus = plan.status;
  if (remaining <= 0) {
    nextStatus = "completed";
  } else {
    // Auto defaulted if any missed
    const hasMissed = schedule.some((s) => s.status === "missed");
    if (hasMissed) nextStatus = "defaulted";
  }

  plan.remainingBalance = remaining;
  plan.status = nextStatus;
  await plan.save();
  return plan;
}

router.get("/", requireAuth, requireRole(["super-admin", "admin", "manager"]), async (req, res, next) => {
  try {
    const { status = "all" } = req.query;
    const query = {};
    if (status && status !== "all") {
      query.status = String(status);
    }

    const itemsRaw = await PaymentPlan.find(query)
      .sort({ createdAt: -1 })
      .populate("tenantId", "name")
      .populate("propertyId", "name")
      .lean();

    const items = itemsRaw.map((p) => ({
      ...p,
      tenant: p.tenantId && typeof p.tenantId === "object" ? p.tenantId : undefined,
      property: p.propertyId && typeof p.propertyId === "object" ? p.propertyId : undefined,
    }));

    res.json({ items });
  } catch (err) {
    next(err);
  }
});

router.get("/summary", requireAuth, requireRole(["super-admin", "admin", "manager"]), async (_req, res, next) => {
  try {
    const [activePlans, completedPlans] = await Promise.all([
      PaymentPlan.countDocuments({ status: { $in: ["draft", "active", "defaulted"] } }),
      PaymentPlan.countDocuments({ status: "completed" }),
    ]);

    const now = new Date();
    const todayIso = now.toISOString().slice(0, 10);

    const upcomingPayments = await PaymentSchedule.countDocuments({
      status: "pending",
      dueDate: { $gte: todayIso },
    });

    const missedPayments = await PaymentSchedule.countDocuments({
      status: { $in: ["missed", "pending"] },
      dueDate: { $lt: todayIso },
    });

    res.json({
      activePlans,
      completedPlans,
      upcomingPayments,
      missedPayments,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/:id", requireAuth, requireRole(["super-admin", "admin", "manager"]), async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: { message: "Invalid plan ID" } });
    }

    const plan = await PaymentPlan.findById(id).lean();
    if (!plan) return res.status(404).json({ error: { message: "Payment plan not found" } });

    const [tenant, property, schedule] = await Promise.all([
      Tenant.findById(plan.tenantId).select("name email phone address amount status notes").lean(),
      Company.findById(plan.propertyId).select("name status").lean(),
      PaymentSchedule.find({ planId: id }).sort({ paymentNumber: 1 }).lean(),
    ]);

    res.json({
      item: {
        ...plan,
        tenant,
        property,
        schedule,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post("/", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    const parsed = createPlanSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload", details: parsed.error.errors } });
    }

    const { tenantId, propertyId, totalBalance, agreementNotes, status, schedule } = parsed.data;

    if (!mongoose.Types.ObjectId.isValid(tenantId) || !mongoose.Types.ObjectId.isValid(propertyId)) {
      return res.status(400).json({ error: { message: "Invalid tenantId/propertyId" } });
    }

    const [tenant, property] = await Promise.all([
      Tenant.findById(tenantId).lean(),
      Company.findById(propertyId).lean(),
    ]);
    if (!tenant) return res.status(404).json({ error: { message: "Tenant not found" } });
    if (!property) return res.status(404).json({ error: { message: "Property not found" } });

    // Validations
    const anyPast = schedule.some((s) => isPastDate(s.dueDate));
    if (anyPast) {
      return res.status(400).json({ error: { message: "Past due dates are not allowed" } });
    }

    const scheduleTotal = schedule.reduce((acc, s) => acc + (Number(s.amount) || 0), 0);
    if (Number(scheduleTotal.toFixed(2)) !== Number(totalBalance.toFixed(2))) {
      return res.status(400).json({ error: { message: "Installments total must equal total balance" } });
    }

    // Ensure unique payment numbers
    const nums = schedule.map((s) => s.paymentNumber);
    if (new Set(nums).size !== nums.length) {
      return res.status(400).json({ error: { message: "Duplicate payment numbers are not allowed" } });
    }

    let createdPlanId = "";
    let createdPlanName = "";

    await session.withTransaction(async () => {
      const createdPlan = await PaymentPlan.create(
        [
          {
            tenantId,
            propertyId,
            totalBalance,
            remainingBalance: totalBalance,
            status,
            agreementNotes,
            createdBy: String(req.user?.username || req.user?.name || ""),
          },
        ],
        { session }
      );

      const plan = createdPlan[0];
      createdPlanId = String(plan._id);
      createdPlanName = `Plan for ${tenant.name}`;

      const scheduleDocs = schedule.map((s) => ({
        planId: plan._id,
        paymentNumber: s.paymentNumber,
        dueDate: s.dueDate,
        dueTime: s.dueTime || "",
        amount: s.amount,
        status: "pending",
        paidAt: null,
      }));

      await PaymentSchedule.insertMany(scheduleDocs, { session });

      res.status(201).json({ item: plan.toObject() });
    });

    // Notify admin and super-admin about the new plan (outside transaction so failure doesn't rollback plan)
    if (createdPlanId) {
      try {
        await createNotification({
          actor: String(req.user?.username || req.user?.name || "Admin"),
          actorRole: String(req.user?.role || "admin"),
          action: "created",
          resourceType: "payment-plan",
          resourceName: createdPlanName,
          details: `Total balance: $${totalBalance}. Property: ${property.name}. Installments: ${schedule.length}`,
          resourceId: createdPlanId,
          link: `/admin/payment-plans/${createdPlanId}`,
        });
      } catch (notifyErr) {
        console.error("[PaymentPlans] Failed to send creation notification:", notifyErr);
      }
    }
  } catch (err) {
    next(err);
  } finally {
    session.endSession();
  }
});

router.patch("/:id", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: { message: "Invalid plan ID" } });
    }

    const parsed = updatePlanSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload", details: parsed.error.errors } });
    }

    await session.withTransaction(async () => {
      const plan = await PaymentPlan.findById(id).session(session);
      if (!plan) {
        return res.status(404).json({ error: { message: "Payment plan not found" } });
      }

      const patch = parsed.data;

      if (patch.tenantId) {
        if (!mongoose.Types.ObjectId.isValid(patch.tenantId)) {
          return res.status(400).json({ error: { message: "Invalid tenantId" } });
        }
        const tenant = await Tenant.findById(patch.tenantId).lean();
        if (!tenant) return res.status(404).json({ error: { message: "Tenant not found" } });
        plan.tenantId = patch.tenantId;
      }

      if (patch.propertyId) {
        if (!mongoose.Types.ObjectId.isValid(patch.propertyId)) {
          return res.status(400).json({ error: { message: "Invalid propertyId" } });
        }
        const property = await Company.findById(patch.propertyId).lean();
        if (!property) return res.status(404).json({ error: { message: "Property not found" } });
        plan.propertyId = patch.propertyId;
      }

      if (typeof patch.totalBalance === "number") {
        plan.totalBalance = patch.totalBalance;
      }

      if (typeof patch.agreementNotes === "string") {
        plan.agreementNotes = patch.agreementNotes;
      }

      if (typeof patch.status === "string") {
        plan.status = patch.status;
      }

      // If schedule update provided, rewrite schedule (Phase 1 simplest)
      if (Array.isArray(patch.schedule)) {
        const anyPast = patch.schedule.some((s) => isPastDate(s.dueDate));
        if (anyPast) {
          return res.status(400).json({ error: { message: "Past due dates are not allowed" } });
        }

        const scheduleTotal = patch.schedule.reduce((acc, s) => acc + (Number(s.amount) || 0), 0);
        if (Number(scheduleTotal.toFixed(2)) !== Number(plan.totalBalance.toFixed(2))) {
          return res.status(400).json({ error: { message: "Installments total must equal total balance" } });
        }

        const nums = patch.schedule.map((s) => s.paymentNumber);
        if (new Set(nums).size !== nums.length) {
          return res.status(400).json({ error: { message: "Duplicate payment numbers are not allowed" } });
        }

        await PaymentSchedule.deleteMany({ planId: id }).session(session);

        const scheduleDocs = patch.schedule.map((s) => ({
          planId: id,
          paymentNumber: s.paymentNumber,
          dueDate: s.dueDate,
          dueTime: s.dueTime || "",
          amount: s.amount,
          status: "pending",
          paidAt: null,
        }));

        await PaymentSchedule.insertMany(scheduleDocs, { session });
      }

      await plan.save({ session });

      // Recompute remaining/status based on paid/missed schedule rows.
      await recomputePlanBalances(id);

      const updated = await PaymentPlan.findById(id).lean();
      res.json({ item: updated });
    });
  } catch (err) {
    next(err);
  } finally {
    session.endSession();
  }
});

module.exports = router;
