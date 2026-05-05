const PaymentSchedule = require("../models/PaymentSchedule");
const PaymentPlan = require("../models/PaymentPlan");
const Tenant = require("../models/Tenant");
const Company = require("../models/Company");
const { createNotification } = require("../utils/notifications");

/**
 * Check for pending installments that are due today or overdue,
 * and send notifications to admin and super-admin.
 */
async function checkPaymentDueNotifications() {
  try {
    const today = new Date().toISOString().slice(0, 10);

    // Find pending installments with dueDate <= today that haven't been notified
    const dueItems = await PaymentSchedule.find({
      status: "pending",
      notified: false,
      dueDate: { $lte: today },
    }).lean();

    if (dueItems.length === 0) return;

    // Group by planId to minimize lookups
    const planIds = [...new Set(dueItems.map((i) => String(i.planId)))];
    const plans = await PaymentPlan.find({
      _id: { $in: planIds },
    }).lean();
    const planMap = new Map(plans.map((p) => [String(p._id), p]));

    const tenantIds = [...new Set(plans.map((p) => String(p.tenantId)))];
    const tenants = await Tenant.find({
      _id: { $in: tenantIds },
    }).lean();
    const tenantMap = new Map(tenants.map((t) => [String(t._id), t]));

    const propertyIds = [...new Set(plans.map((p) => String(p.propertyId)))];
    const properties = await Company.find({
      _id: { $in: propertyIds },
    }).lean();
    const propertyMap = new Map(properties.map((c) => [String(c._id), c]));

    for (const item of dueItems) {
      const plan = planMap.get(String(item.planId));
      if (!plan) continue;

      const tenant = tenantMap.get(String(plan.tenantId));
      const property = propertyMap.get(String(plan.propertyId));
      const tenantName = tenant?.name || "Tenant";
      const propertyName = property?.name || "Property";

      const isOverdue = item.dueDate < today;
      const action = isOverdue ? "overdue" : "due";
      const titleText = isOverdue
        ? "Payment Overdue"
        : "Payment Due Today";
      const content = `${tenantName} – Installment #${item.paymentNumber} for ${propertyName} is ${action}. Amount: $${item.amount}.`;

      await createNotification({
        actor: "system",
        actorRole: "system",
        action: action,
        resourceType: "payment-plan",
        resourceName: `${tenantName} – Installment #${item.paymentNumber}`,
        details: content,
        resourceId: String(plan._id),
        link: `/admin/payment-plans/${plan._id}`,
      });

      // Mark as notified so we don't spam
      await PaymentSchedule.updateOne(
        { _id: item._id },
        { $set: { notified: true, notifiedAt: new Date() } }
      );
    }

    console.log(`[PaymentNotifications] Checked ${dueItems.length} due installments.`);
  } catch (err) {
    console.error("[PaymentNotifications] Error checking due payments:", err);
  }
}

/**
 * Start the payment notification scheduler.
 * Runs immediately once, then every 30 minutes.
 */
function startPaymentNotificationScheduler() {
  // Run immediately on startup
  void checkPaymentDueNotifications();

  // Then every 30 minutes
  const interval = 30 * 60 * 1000; // 30 minutes in ms
  setInterval(() => {
    void checkPaymentDueNotifications();
  }, interval);

  console.log("[PaymentNotifications] Scheduler started (interval: 30 minutes)");
}

module.exports = { startPaymentNotificationScheduler, checkPaymentDueNotifications };
