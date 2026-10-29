const EmployeeDocument = require("../models/EmployeeDocument");
const EmployeeTraining = require("../models/EmployeeTraining");
const Employee = require("../models/Employee");
const { createNotification } = require("../utils/notifications");

/**
 * Background Job: Checks for expiring employee documents, certifications, and licenses.
 * Sends advance notices at 30 days, 15 days, and 7 days.
 */
async function checkEmployeeExpirations() {
  try {
    const now = new Date();
    const thirtyDaysAhead = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    // 1. Check Expiring Documents
    const expiringDocs = await EmployeeDocument.find({
      expirationDate: { $lte: thirtyDaysAhead, $gte: now },
      isArchived: false,
      status: "active",
    }).populate("employeeId", "name email");

    for (const doc of expiringDocs) {
      const daysLeft = Math.ceil((new Date(doc.expirationDate) - now) / (1000 * 60 * 60 * 24));
      const empName = doc.employeeId?.name || "Employee";

      await createNotification({
        actor: "Compliance System",
        actorRole: "system",
        action: "document expiring soon",
        resourceType: "employee_document",
        resourceName: doc.title,
        details: `Document "${doc.title}" for ${empName} will expire in ${daysLeft} days (${new Date(doc.expirationDate).toLocaleDateString()}).`,
        resourceId: String(doc._id),
      }).catch(() => {});
    }

    // Mark past due documents as expired
    await EmployeeDocument.updateMany(
      { expirationDate: { $lt: now }, isArchived: false, status: "active" },
      { $set: { status: "expired" } }
    );

    // 2. Check Expiring Certifications and Training
    const expiringTrainings = await EmployeeTraining.find({
      expirationDate: { $lte: thirtyDaysAhead, $gte: now },
      doesNotExpire: false,
      status: "active",
    }).populate("employeeId", "name email");

    for (const item of expiringTrainings) {
      const daysLeft = Math.ceil((new Date(item.expirationDate) - now) / (1000 * 60 * 60 * 24));
      const empName = item.employeeId?.name || "Employee";

      await createNotification({
        actor: "Training Compliance",
        actorRole: "system",
        action: "certification renewal required",
        resourceType: "employee_training",
        resourceName: item.name,
        details: `${item.type.toUpperCase()} "${item.name}" for ${empName} expires in ${daysLeft} days. Renewal required.`,
        resourceId: String(item._id),
      }).catch(() => {});
    }

    // Mark past due certifications as expired
    await EmployeeTraining.updateMany(
      { expirationDate: { $lt: now }, doesNotExpire: false, status: "active" },
      { $set: { status: "expired" } }
    );
  } catch (err) {
    console.error("[Employee Expiry Job Error]:", err.message);
  }
}

module.exports = { checkEmployeeExpirations };
