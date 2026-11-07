const CostLineItem = require("../models/CostLineItem");
const CertificationRequirement = require("../models/CertificationRequirement");
const Project = require("../models/Project");
const { createNotification } = require("../utils/notifications");

const NOT_STORED_DELAY_DAYS = 3;
const CERT_DUE_WINDOW_DAYS = 7;

async function projectNameMap(projectIds) {
  const ids = [...new Set(projectIds)].filter(Boolean);
  const projects = await Project.find({ _id: { $in: ids } }).select("name assignees").lean();
  return new Map(projects.map((p) => [String(p._id), p]));
}

// Alert when items were purchased/received but never assigned a storage location.
async function checkPurchasedNotStored() {
  const cutoff = new Date(Date.now() - NOT_STORED_DELAY_DAYS * 24 * 60 * 60 * 1000);
  const items = await CostLineItem.find({
    purchaseStatus: { $in: ["purchased", "received"] },
    isActive: { $ne: false },
    notStoredAlertSentAt: null,
    updatedAt: { $lt: cutoff },
  })
    .limit(100)
    .lean();
  if (items.length === 0) return;

  const projects = await projectNameMap(items.map((i) => i.projectId));
  for (const item of items) {
    const project = projects.get(String(item.projectId));
    await createNotification({
      actor: "Cost Manager",
      actorRole: "system",
      action: "flagged unstored purchase on",
      resourceType: "project",
      resourceName: project?.name || "project",
      assignees: project?.assignees || [],
      details: `"${item.itemName}" was ${item.purchaseStatus} over ${NOT_STORED_DELAY_DAYS} days ago but has no storage location yet`,
      resourceId: String(item.projectId),
      category: "COST_ALERT",
    });
    await CostLineItem.updateOne({ _id: item._id }, { $set: { notStoredAlertSentAt: new Date() } });
  }
  console.log(`[Cost Manager Job] Sent ${items.length} purchased-but-not-stored alert(s)`);
}

// Alert when a lab/UL/permit/certification deadline is inside the warning window.
async function checkCertificationDueDates() {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + CERT_DUE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const certs = await CertificationRequirement.find({
    dueDate: { $ne: null, $lte: windowEnd },
    status: { $in: ["planned", "quoted", "submitted", "in_progress"] },
    dueAlertSentAt: null,
  })
    .limit(100)
    .lean();
  if (certs.length === 0) return;

  const projects = await projectNameMap(certs.map((c) => c.projectId));
  for (const cert of certs) {
    const project = projects.get(String(cert.projectId));
    const overdue = cert.dueDate < now;
    await createNotification({
      actor: "Cost Manager",
      actorRole: "system",
      action: overdue ? "flagged overdue certification on" : "flagged upcoming certification deadline on",
      resourceType: "project",
      resourceName: project?.name || "project",
      assignees: project?.assignees || [],
      details: `${cert.name} (${cert.requirementType.replace(/_/g, " ")}) is due ${new Date(cert.dueDate).toLocaleDateString()}`,
      resourceId: String(cert.projectId),
      category: "COST_ALERT",
    });
    await CertificationRequirement.updateOne({ _id: cert._id }, { $set: { dueAlertSentAt: new Date() } });
  }
  console.log(`[Cost Manager Job] Sent ${certs.length} certification deadline alert(s)`);
}

async function runCostManagerChecks() {
  await checkPurchasedNotStored();
  await checkCertificationDueDates();
}

module.exports = { runCostManagerChecks };
