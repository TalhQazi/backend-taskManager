const express = require("express");
const { z } = require("zod");
const mongoose = require("mongoose");
const crypto = require("crypto");
const CostSheet = require("../models/CostSheet");
const CostSection = require("../models/CostSection");
const CostLineItem = require("../models/CostLineItem");
const CostAuditLog = require("../models/CostAuditLog");
const CostInventoryRecord = require("../models/CostInventoryRecord");
const CertificationRequirement = require("../models/CertificationRequirement");
const Project = require("../models/Project");
const { uploadToS3 } = require("../lib/s3");
const { createNotification } = require("../utils/notifications");
const { requireAuth } = require("../middleware/auth");

const { READINESS_WEIGHTS } = CostLineItem;

const router = express.Router();

const ADMIN_ROLES = ["super-admin", "admin", "manager", "team-lead"];
const PRIORITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };

const DEFAULT_SECTIONS = ["Materials", "Manufacturing", "Testing", "Certification", "Shipping", "Taxes / Fees"];

// ---------- helpers ----------

function toCents(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

// Parse a data URL ("data:<mime>;base64,<data>") into { mimeType, buffer }.
// More tolerant than lib/s3's base64ToBuffer (handles mimes with dots/digits).
function parseDataUrl(dataUrl) {
  const str = String(dataUrl || "");
  const comma = str.indexOf(",");
  if (!str.startsWith("data:") || comma === -1) return null;
  const header = str.slice(5, comma); // "<mime>;base64"
  const mimeType = header.split(";")[0] || "application/octet-stream";
  try {
    return { mimeType, buffer: Buffer.from(str.slice(comma + 1), "base64") };
  } catch {
    return null;
  }
}

function generateQrCode() {
  return `CM-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

// Fires once when projected cost crosses above the available budget; resets
// when it drops back under so a future crossing alerts again.
async function maybeSendBudgetAlert(req, sheet, summary) {
  try {
    const over =
      summary.availableBudgetCents > 0 && summary.projectedCents > summary.availableBudgetCents;
    if (over && !sheet.budgetAlertActive) {
      sheet.budgetAlertActive = true;
      await sheet.save();
      const project = await Project.findById(sheet.projectId).select("name assignees").lean();
      await createNotification({
        actor: req.user?.username || req.user?.name || "Cost Manager",
        actorRole: req.user?.role || "system",
        action: "flagged budget exceeded on",
        resourceType: "project",
        resourceName: project?.name || "project",
        assignees: project?.assignees || [],
        details: `Projected prototype cost is now over the available budget by ${(
          (summary.projectedCents - summary.availableBudgetCents) / 100
        ).toFixed(2)} ${sheet.currency || "USD"}`,
        resourceId: String(sheet.projectId),
        category: "COST_ALERT",
      });
    } else if (!over && sheet.budgetAlertActive) {
      sheet.budgetAlertActive = false;
      await sheet.save();
    }
  } catch (err) {
    console.error("[CostManager] budget alert failed:", err.message);
  }
}

// Cost Calculation Engine — server-side authoritative.
function computeItemTotals(item) {
  const base = Math.round(Number(item.qty || 0) * Number(item.unitCostCents || 0));
  const estimated = base + toCents(item.shippingCostCents) + toCents(item.taxCostCents) + toCents(item.otherFeesCents);
  const paid = toCents(item.paidCents);
  item.estimatedTotalCents = estimated;
  item.remainingCents = Math.max(0, estimated - paid);
  return item;
}

function isIncluded(item) {
  return item.isActive !== false && item.purchaseStatus !== "canceled";
}

function buildSummary(sheet, items) {
  const included = items.filter(isIncluded);
  const projectedCents = included.reduce((s, i) => s + (i.estimatedTotalCents || 0), 0);
  const spentCents = included.reduce((s, i) => s + (i.paidCents || 0), 0);
  const remainingCents = Math.max(0, projectedCents - spentCents);

  const purchasedStatuses = ["purchased", "shipped", "received", "stored"];
  const purchasedCount = included.filter((i) => purchasedStatuses.includes(i.purchaseStatus)).length;

  // Build readiness: weighted by estimated cost across required-for-prototype items
  // (falls back to all included items when nothing is flagged required).
  const requiredItems = included.filter((i) => i.requiredForPrototype);
  const readinessPool = requiredItems.length > 0 ? requiredItems : included;
  const poolTotal = readinessPool.reduce((s, i) => s + (i.estimatedTotalCents || 0), 0);
  let buildReadinessPct = 0;
  if (poolTotal > 0) {
    const weighted = readinessPool.reduce(
      (s, i) => s + (i.estimatedTotalCents || 0) * (READINESS_WEIGHTS[i.purchaseStatus] || 0),
      0
    );
    buildReadinessPct = Math.round(weighted / poolTotal);
  } else if (readinessPool.length > 0) {
    const weighted = readinessPool.reduce((s, i) => s + (READINESS_WEIGHTS[i.purchaseStatus] || 0), 0);
    buildReadinessPct = Math.round(weighted / readinessPool.length);
  }

  // Largest remaining blocker: unpaid/incomplete required item, highest priority then largest remaining.
  const blockers = included
    .filter((i) => i.requiredForPrototype && i.remainingCents > 0 && !["received", "stored"].includes(i.purchaseStatus))
    .sort((a, b) => {
      const p = (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2);
      if (p !== 0) return p;
      return (b.remainingCents || 0) - (a.remainingCents || 0);
    });
  const nextBlocker = blockers[0] || null;

  return {
    projectedCents,
    spentCents,
    remainingCents,
    availableBudgetCents: sheet.availableBudgetCents || 0,
    budgetAfterRemainingCents: (sheet.availableBudgetCents || 0) - remainingCents,
    purchasedCount,
    totalCount: included.length,
    purchasedPct: projectedCents > 0 ? Math.round((spentCents / projectedCents) * 1000) / 10 : 0,
    buildReadinessPct,
    nextBlocker: nextBlocker
      ? {
          id: String(nextBlocker._id),
          itemName: nextBlocker.itemName,
          remainingCents: nextBlocker.remainingCents,
          priority: nextBlocker.priority,
          purchaseStatus: nextBlocker.purchaseStatus,
        }
      : null,
  };
}

function serializeItem(i) {
  return {
    id: String(i._id),
    costSheetId: String(i.costSheetId),
    costSectionId: String(i.costSectionId),
    projectId: i.projectId,
    taskId: i.taskId || "",
    itemName: i.itemName,
    description: i.description || "",
    expenseType: i.expenseType || "other",
    qty: i.qty,
    unit: i.unit || "",
    unitCostCents: i.unitCostCents || 0,
    shippingCostCents: i.shippingCostCents || 0,
    taxCostCents: i.taxCostCents || 0,
    otherFeesCents: i.otherFeesCents || 0,
    estimatedTotalCents: i.estimatedTotalCents || 0,
    paidCents: i.paidCents || 0,
    remainingCents: i.remainingCents || 0,
    vendorId: i.vendorId ? String(i.vendorId._id || i.vendorId) : null,
    vendor: i.vendorId && i.vendorId.name
      ? {
          id: String(i.vendorId._id),
          name: i.vendorId.name,
          phone: i.vendorId.phone || "",
          email: i.vendorId.email || "",
          website: i.vendorId.website || "",
          address: [i.vendorId.street, i.vendorId.city, i.vendorId.state, i.vendorId.zip].filter(Boolean).join(", "),
          notes: i.vendorId.notes || "",
        }
      : null,
    quoteNumber: i.quoteNumber || "",
    purchaseStatus: i.purchaseStatus,
    priority: i.priority,
    requiredForPrototype: !!i.requiredForPrototype,
    isActive: i.isActive !== false,
    storage: i.storage || {},
    attachments: (i.attachments || []).map((a) => ({
      id: String(a._id),
      fileName: a.fileName,
      url: a.url,
      mimeType: a.mimeType,
      size: a.size || 0,
      fileType: a.fileType || "other",
      uploadedByUsername: a.uploadedByUsername || "",
      uploadedAt: a.uploadedAt,
    })),
    warnings: buildItemWarnings(i),
    notes: i.notes || "",
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
  };
}

// Missing-information warnings surfaced as badges and filters in the UI.
function buildItemWarnings(i) {
  if (!isIncluded(i)) return [];
  const warnings = [];
  const purchasedTrack = ["purchased", "shipped", "received", "stored"].includes(i.purchaseStatus);
  if ((i.estimatedTotalCents || 0) > 0 && !i.vendorId) warnings.push("missing_vendor");
  if (purchasedTrack) {
    const hasProof = (i.attachments || []).some((a) => ["invoice", "receipt"].includes(a.fileType));
    if (!hasProof) warnings.push("missing_receipt");
    if (i.purchaseStatus !== "stored") warnings.push("not_stored");
  }
  return warnings;
}

function serializeCertification(c) {
  return {
    id: String(c._id),
    projectId: c.projectId,
    lineItemId: c.lineItemId ? String(c.lineItemId) : null,
    requirementType: c.requirementType,
    name: c.name,
    authorityOrLab: c.authorityOrLab || "",
    standard: c.standard || "",
    status: c.status,
    requiredForPrototype: !!c.requiredForPrototype,
    estimatedCostCents: c.estimatedCostCents || 0,
    paidCents: c.paidCents || 0,
    dueDate: c.dueDate,
    filingDate: c.filingDate,
    approvalDate: c.approvalDate,
    expirationDate: c.expirationDate,
    result: c.result || "",
    notes: c.notes || "",
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

async function writeAudit(req, entityType, entityId, projectId, action, oldValue, newValue) {
  try {
    await CostAuditLog.create({
      entityType,
      entityId: String(entityId),
      projectId: String(projectId || ""),
      userId: req.user?.id || "",
      username: req.user?.username || req.user?.name || req.user?.email || "",
      action,
      oldValue: oldValue || null,
      newValue: newValue || null,
      ipAddress: req.ip || req.headers["x-forwarded-for"] || "",
    });
  } catch (err) {
    console.error("[CostManager] audit log write failed:", err.message);
  }
}

async function loadSheetPayload(sheet) {
  const [sections, items, certifications] = await Promise.all([
    CostSection.find({ costSheetId: sheet._id }).sort({ sortOrder: 1, createdAt: 1 }).lean(),
    CostLineItem.find({ costSheetId: sheet._id })
      .populate("vendorId", "name phone email website street city state zip notes")
      .sort({ createdAt: 1 })
      .lean(),
    CertificationRequirement.find({ costSheetId: sheet._id }).sort({ createdAt: 1 }).lean(),
  ]);

  const itemsBySection = new Map();
  for (const item of items) {
    const key = String(item.costSectionId);
    if (!itemsBySection.has(key)) itemsBySection.set(key, []);
    itemsBySection.get(key).push(item);
  }

  const sectionPayloads = sections.map((s) => {
    const sectionItems = itemsBySection.get(String(s._id)) || [];
    const included = sectionItems.filter(isIncluded);
    return {
      id: String(s._id),
      name: s.name,
      sortOrder: s.sortOrder,
      isRequired: !!s.isRequired,
      subtotalEstimatedCents: included.reduce((sum, i) => sum + (i.estimatedTotalCents || 0), 0),
      subtotalPaidCents: included.reduce((sum, i) => sum + (i.paidCents || 0), 0),
      items: sectionItems.map(serializeItem),
    };
  });

  return {
    sheet: {
      id: String(sheet._id),
      projectId: sheet.projectId,
      name: sheet.name,
      currency: sheet.currency,
      availableBudgetCents: sheet.availableBudgetCents || 0,
    },
    sections: sectionPayloads,
    certifications: certifications.map(serializeCertification),
    summary: buildSummary(sheet, items),
  };
}

// ---------- validation ----------

const moneyCents = z.number().int().min(0).max(1e13);

const sheetPatchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  availableBudgetCents: moneyCents.optional(),
});

const sectionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  sortOrder: z.number().int().optional(),
  isRequired: z.boolean().optional(),
});

const itemBaseSchema = z.object({
  itemName: z.string().trim().min(1).max(300),
  description: z.string().max(2000).optional(),
  expenseType: z
    .enum(["material", "manufacturing", "testing", "certification", "permit", "shipping", "tax", "lab", "packaging", "other"])
    .optional(),
  qty: z.number().min(0).max(1e9).optional(),
  unit: z.string().max(40).optional(),
  unitCostCents: moneyCents.optional(),
  shippingCostCents: moneyCents.optional(),
  taxCostCents: moneyCents.optional(),
  otherFeesCents: moneyCents.optional(),
  paidCents: moneyCents.optional(),
  vendorId: z.string().nullable().optional(),
  quoteNumber: z.string().max(120).optional(),
  taskId: z.string().max(64).optional(),
  purchaseStatus: z
    .enum(["not_purchased", "ready_to_buy", "partially_paid", "purchased", "shipped", "received", "stored", "delayed", "canceled"])
    .optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  requiredForPrototype: z.boolean().optional(),
  isActive: z.boolean().optional(),
  notes: z.string().max(2000).optional(),
  storage: z
    .object({
      locationName: z.string().max(200).optional(),
      address: z.string().max(300).optional(),
      building: z.string().max(120).optional(),
      room: z.string().max(120).optional(),
      aisle: z.string().max(60).optional(),
      shelf: z.string().max(60).optional(),
      bin: z.string().max(60).optional(),
      qtyStored: z.number().min(0).optional(),
      notes: z.string().max(1000).optional(),
    })
    .optional(),
});

const itemCreateSchema = itemBaseSchema;
const itemPatchSchema = itemBaseSchema.partial();

function requireEditor(req, res) {
  // Phase 1 permission model: every authenticated staff role may edit;
  // hard deletes of sections are limited to admin/manager roles below.
  if (!req.user?.role) {
    res.status(403).json({ error: { message: "Forbidden" } });
    return false;
  }
  return true;
}

// ---------- routes ----------

// GET /api/cost-manager/projects/:projectId — get the project cost sheet.
router.get("/projects/:projectId", requireAuth, async (req, res, next) => {
  try {
    const { projectId } = req.params;
    if (!mongoose.isValidObjectId(projectId)) {
      return res.status(400).json({ error: { message: "Invalid project id" } });
    }
    const project = await Project.findById(projectId).select("name").lean();
    if (!project) return res.status(404).json({ error: { message: "Project not found" } });

    let sheet = await CostSheet.findOne({ projectId });
    if (!sheet) {
      return res.json(null);
    }

    const payload = await loadSheetPayload(sheet);
    void maybeSendBudgetAlert(req, sheet, payload.summary);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

// GET /api/cost-manager/tasks/:taskId — get the task cost sheet.
router.get("/tasks/:taskId", requireAuth, async (req, res, next) => {
  try {
    const { taskId } = req.params;
    if (!mongoose.isValidObjectId(taskId)) {
      return res.status(400).json({ error: { message: "Invalid task id" } });
    }
    const task = await Task.findById(taskId).select("title").lean();
    if (!task) return res.status(404).json({ error: { message: "Task not found" } });

    let sheet = await CostSheet.findOne({ taskId });
    if (!sheet) {
      return res.json(null);
    }

    const payload = await loadSheetPayload(sheet);
    void maybeSendBudgetAlert(req, sheet, payload.summary);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

// GET /api/cost-manager/sheets — get all cost sheets
router.get("/sheets", requireAuth, async (req, res, next) => {
  try {
    const sheets = await CostSheet.find({}).sort({ createdAt: -1 }).lean();
    res.json({ items: sheets });
  } catch (err) {
    next(err);
  }
});

// POST /api/cost-manager/sheets — create a new cost sheet
router.post("/sheets", requireAuth, async (req, res, next) => {
  try {
    if (!requireEditor(req, res)) return;
    const { name, availableBudgetCents } = req.body;
    if (!name) return res.status(400).json({ error: { message: "Name is required" } });

    const sheet = await CostSheet.create({
      name,
      availableBudgetCents: Number(availableBudgetCents) || 0,
      createdByUserId: req.user?.id || "",
      createdByUsername: req.user?.username || req.user?.name || "",
    });

    await CostSection.insertMany(
      DEFAULT_SECTIONS.map((sectionName, idx) => ({ costSheetId: sheet._id, name: sectionName, sortOrder: idx }))
    );

    await writeAudit(req, "cost_sheet", sheet._id, null, "create", null, { name: sheet.name });
    res.status(201).json(sheet);
  } catch (err) {
    next(err);
  }
});

// GET /api/cost-manager/sheets/:sheetId — fetch a cost sheet payload by ID
router.get("/sheets/:sheetId", requireAuth, async (req, res, next) => {
  try {
    const sheet = await CostSheet.findById(req.params.sheetId);
    if (!sheet) return res.status(404).json({ error: { message: "Cost sheet not found" } });

    const payload = await loadSheetPayload(sheet);
    void maybeSendBudgetAlert(req, sheet, payload.summary);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/cost-manager/sheets/:sheetId/attach — link/unlink a cost sheet to a project or task
router.patch("/sheets/:sheetId/attach", requireAuth, async (req, res, next) => {
  try {
    const role = String(req.user?.role || "").toLowerCase();
    if (role !== "super-admin" && role !== "admin") {
      return res.status(403).json({ error: { message: "Only admins or super-admins can attach expense sheets" } });
    }

    const sheet = await CostSheet.findById(req.params.sheetId);
    if (!sheet) return res.status(404).json({ error: { message: "Cost sheet not found" } });

    const projectId = req.body.projectId || null;
    const taskId = req.body.taskId || null;

    // Detach from previous project/task if any
    const oldProject = sheet.projectId;
    const oldTask = sheet.taskId;

    sheet.projectId = projectId;
    sheet.taskId = taskId;
    await sheet.save();

    // Also update all line items and certifications associated with this sheet
    await CostLineItem.updateMany({ costSheetId: sheet._id }, { $set: { projectId, taskId } });
    await CertificationRequirement.updateMany({ costSheetId: sheet._id }, { $set: { projectId } });

    await writeAudit(req, "cost_sheet", sheet._id, projectId, "attach", { projectId: oldProject, taskId: oldTask }, { projectId, taskId });

    res.json({ success: true, item: sheet });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/cost-manager/sheets/:sheetId — delete a cost sheet, sections, line items, and certifications
router.delete("/sheets/:sheetId", requireAuth, async (req, res, next) => {
  try {
    const role = String(req.user?.role || "").toLowerCase();
    if (role !== "super-admin" && role !== "admin") {
      return res.status(403).json({ error: { message: "Only admins or super-admins can delete expense sheets" } });
    }

    const sheet = await CostSheet.findById(req.params.sheetId);
    if (!sheet) return res.status(404).json({ error: { message: "Cost sheet not found" } });

    await CostSection.deleteMany({ costSheetId: sheet._id });
    await CostLineItem.deleteMany({ costSheetId: sheet._id });
    await CertificationRequirement.deleteMany({ costSheetId: sheet._id });
    await sheet.deleteOne();

    await writeAudit(req, "cost_sheet", sheet._id, sheet.projectId, "delete", { name: sheet.name }, null);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/cost-manager/sheets/:sheetId — update name / available budget.
router.patch("/sheets/:sheetId", requireAuth, async (req, res, next) => {
  try {
    if (!requireEditor(req, res)) return;
    const parsed = sheetPatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { message: parsed.error.issues[0]?.message || "Invalid payload" } });

    const sheet = await CostSheet.findById(req.params.sheetId);
    if (!sheet) return res.status(404).json({ error: { message: "Cost sheet not found" } });

    const old = { name: sheet.name, availableBudgetCents: sheet.availableBudgetCents };
    if (parsed.data.name !== undefined) sheet.name = parsed.data.name;
    if (parsed.data.availableBudgetCents !== undefined) sheet.availableBudgetCents = parsed.data.availableBudgetCents;
    await sheet.save();

    await writeAudit(req, "cost_sheet", sheet._id, sheet.projectId, "update", old, parsed.data);
    const payload = await loadSheetPayload(sheet);
    void maybeSendBudgetAlert(req, sheet, payload.summary);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

// POST /api/cost-manager/sheets/:sheetId/sections
router.post("/sheets/:sheetId/sections", requireAuth, async (req, res, next) => {
  try {
    if (!requireEditor(req, res)) return;
    const parsed = sectionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { message: parsed.error.issues[0]?.message || "Invalid payload" } });

    const sheet = await CostSheet.findById(req.params.sheetId);
    if (!sheet) return res.status(404).json({ error: { message: "Cost sheet not found" } });

    const maxSort = await CostSection.find({ costSheetId: sheet._id }).sort({ sortOrder: -1 }).limit(1).lean();
    const section = await CostSection.create({
      costSheetId: sheet._id,
      name: parsed.data.name,
      sortOrder: parsed.data.sortOrder ?? ((maxSort[0]?.sortOrder ?? -1) + 1),
      isRequired: parsed.data.isRequired ?? false,
    });

    await writeAudit(req, "cost_section", section._id, sheet.projectId, "create", null, { name: section.name });
    const payload = await loadSheetPayload(sheet);
    void maybeSendBudgetAlert(req, sheet, payload.summary);
    res.status(201).json(payload);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/cost-manager/sections/:sectionId
router.patch("/sections/:sectionId", requireAuth, async (req, res, next) => {
  try {
    if (!requireEditor(req, res)) return;
    const parsed = sectionSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { message: parsed.error.issues[0]?.message || "Invalid payload" } });

    const section = await CostSection.findById(req.params.sectionId);
    if (!section) return res.status(404).json({ error: { message: "Section not found" } });
    const sheet = await CostSheet.findById(section.costSheetId);
    if (!sheet) return res.status(404).json({ error: { message: "Cost sheet not found" } });

    const old = { name: section.name, sortOrder: section.sortOrder, isRequired: section.isRequired };
    Object.assign(section, parsed.data);
    await section.save();

    await writeAudit(req, "cost_section", section._id, sheet.projectId, "update", old, parsed.data);
    const payload = await loadSheetPayload(sheet);
    void maybeSendBudgetAlert(req, sheet, payload.summary);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/cost-manager/sections/:sectionId — admin/manager only; removes its line items.
router.delete("/sections/:sectionId", requireAuth, async (req, res, next) => {
  try {
    if (!ADMIN_ROLES.includes(req.user?.role)) {
      return res.status(403).json({ error: { message: "Only admins or managers can delete sections" } });
    }
    const section = await CostSection.findById(req.params.sectionId);
    if (!section) return res.status(404).json({ error: { message: "Section not found" } });
    const sheet = await CostSheet.findById(section.costSheetId);
    if (!sheet) return res.status(404).json({ error: { message: "Cost sheet not found" } });

    await CostLineItem.deleteMany({ costSectionId: section._id });
    await section.deleteOne();

    await writeAudit(req, "cost_section", section._id, sheet.projectId, "delete", { name: section.name }, null);
    const payload = await loadSheetPayload(sheet);
    void maybeSendBudgetAlert(req, sheet, payload.summary);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

// POST /api/cost-manager/sections/:sectionId/items
router.post("/sections/:sectionId/items", requireAuth, async (req, res, next) => {
  try {
    if (!requireEditor(req, res)) return;
    const parsed = itemCreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { message: parsed.error.issues[0]?.message || "Invalid payload" } });

    const section = await CostSection.findById(req.params.sectionId);
    if (!section) return res.status(404).json({ error: { message: "Section not found" } });
    const sheet = await CostSheet.findById(section.costSheetId);
    if (!sheet) return res.status(404).json({ error: { message: "Cost sheet not found" } });

    const data = parsed.data;
    if (data.vendorId && !mongoose.isValidObjectId(data.vendorId)) data.vendorId = null;

    const item = new CostLineItem({
      ...data,
      vendorId: data.vendorId || null,
      costSheetId: sheet._id,
      costSectionId: section._id,
      projectId: sheet.projectId,
      createdByUserId: req.user?.id || "",
      createdByUsername: req.user?.username || req.user?.name || "",
    });
    computeItemTotals(item);
    await item.save();

    await writeAudit(req, "cost_line_item", item._id, sheet.projectId, "create", null, {
      itemName: item.itemName,
      estimatedTotalCents: item.estimatedTotalCents,
    });
    const payload = await loadSheetPayload(sheet);
    void maybeSendBudgetAlert(req, sheet, payload.summary);
    res.status(201).json(payload);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/cost-manager/items/:itemId — edit fields, payments, status changes.
router.patch("/items/:itemId", requireAuth, async (req, res, next) => {
  try {
    if (!requireEditor(req, res)) return;
    const parsed = itemPatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { message: parsed.error.issues[0]?.message || "Invalid payload" } });

    const item = await CostLineItem.findById(req.params.itemId);
    if (!item) return res.status(404).json({ error: { message: "Line item not found" } });
    const sheet = await CostSheet.findById(item.costSheetId);
    if (!sheet) return res.status(404).json({ error: { message: "Cost sheet not found" } });

    const data = { ...parsed.data };
    if (data.vendorId !== undefined && data.vendorId && !mongoose.isValidObjectId(data.vendorId)) {
      return res.status(400).json({ error: { message: "Invalid vendor id" } });
    }

    // "Stored" is not allowed without an exact storage location
    // (either on the item itself or via at least one inventory record).
    const nextStatus = data.purchaseStatus ?? item.purchaseStatus;
    const nextStorage = { ...(item.storage?.toObject?.() || item.storage || {}), ...(data.storage || {}) };
    if (nextStatus === "stored") {
      const hasLocation = String(nextStorage.locationName || "").trim().length > 0;
      const hasDetail = ["room", "aisle", "shelf", "bin", "building"].some(
        (f) => String(nextStorage[f] || "").trim().length > 0
      );
      if (!hasLocation || !hasDetail) {
        const recordCount = await CostInventoryRecord.countDocuments({ lineItemId: item._id });
        if (recordCount === 0) {
          return res.status(400).json({
            error: { message: "Stored status requires a location name and an exact placement (building, room, aisle, shelf, or bin)." },
          });
        }
      }
    }

    const old = {
      purchaseStatus: item.purchaseStatus,
      paidCents: item.paidCents,
      estimatedTotalCents: item.estimatedTotalCents,
      itemName: item.itemName,
    };

    const statusChanged = data.purchaseStatus !== undefined && data.purchaseStatus !== item.purchaseStatus;
    const paymentChanged = data.paidCents !== undefined && data.paidCents !== item.paidCents;

    if (data.storage) {
      data.storage = nextStorage;
      if (statusChanged && data.purchaseStatus === "stored") {
        data.storage.storedByUsername = req.user?.username || req.user?.name || "";
        data.storage.storedAt = new Date();
      }
    }
    Object.assign(item, data);

    // Marking purchased with no explicit payment counts the full estimate as paid.
    computeItemTotals(item);
    if (statusChanged && item.purchaseStatus === "purchased" && !paymentChanged && (item.paidCents || 0) === 0) {
      item.paidCents = item.estimatedTotalCents;
      computeItemTotals(item);
    }
    // A partial payment on a purchased-track item reflects as partially_paid unless caller set a status.
    if (paymentChanged && !statusChanged) {
      if (item.paidCents > 0 && item.paidCents < item.estimatedTotalCents && ["not_purchased", "ready_to_buy"].includes(item.purchaseStatus)) {
        item.purchaseStatus = "partially_paid";
      } else if (item.paidCents >= item.estimatedTotalCents && item.estimatedTotalCents > 0 && ["not_purchased", "ready_to_buy", "partially_paid"].includes(item.purchaseStatus)) {
        item.purchaseStatus = "purchased";
      }
    }

    await item.save();

    const action = statusChanged ? "status_change" : paymentChanged ? "payment" : "update";
    await writeAudit(req, "cost_line_item", item._id, sheet.projectId, action, old, {
      purchaseStatus: item.purchaseStatus,
      paidCents: item.paidCents,
      estimatedTotalCents: item.estimatedTotalCents,
      itemName: item.itemName,
    });
    const payload = await loadSheetPayload(sheet);
    void maybeSendBudgetAlert(req, sheet, payload.summary);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/cost-manager/items/:itemId
router.delete("/items/:itemId", requireAuth, async (req, res, next) => {
  try {
    if (!requireEditor(req, res)) return;
    const item = await CostLineItem.findById(req.params.itemId);
    if (!item) return res.status(404).json({ error: { message: "Line item not found" } });
    const sheet = await CostSheet.findById(item.costSheetId);

    await item.deleteOne();
    await writeAudit(req, "cost_line_item", item._id, item.projectId, "delete", { itemName: item.itemName }, null);

    if (!sheet) return res.json({ ok: true });
    const payload = await loadSheetPayload(sheet);
    void maybeSendBudgetAlert(req, sheet, payload.summary);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

// GET /api/cost-manager/tasks/:taskId/items — expenses linked to one task.
router.get("/tasks/:taskId/items", requireAuth, async (req, res, next) => {
  try {
    const items = await CostLineItem.find({ taskId: String(req.params.taskId) })
      .populate("vendorId", "name phone email website street city state zip notes")
      .sort({ createdAt: 1 })
      .lean();
    res.json({ items: items.map(serializeItem) });
  } catch (err) {
    next(err);
  }
});

// ---------- files (quotes, invoices, receipts, spec sheets, lab reports) ----------

const fileTypeEnum = z.enum([
  "quote",
  "invoice",
  "receipt",
  "purchase_order",
  "spec_sheet",
  "safety_data_sheet",
  "lab_report",
  "photo",
  "tracking",
  "other",
]);

const filesUploadSchema = z.object({
  files: z
    .array(
      z.object({
        fileName: z.string().trim().min(1).max(300),
        fileType: fileTypeEnum.optional(),
        dataUrl: z.string().min(20),
      })
    )
    .min(1)
    .max(10),
});

// POST /api/cost-manager/items/:itemId/files — attach documents (base64 data URLs).
router.post("/items/:itemId/files", requireAuth, async (req, res, next) => {
  try {
    if (!requireEditor(req, res)) return;
    const parsed = filesUploadSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { message: parsed.error.issues[0]?.message || "Invalid payload" } });

    const item = await CostLineItem.findById(req.params.itemId);
    if (!item) return res.status(404).json({ error: { message: "Line item not found" } });
    const sheet = await CostSheet.findById(item.costSheetId);
    if (!sheet) return res.status(404).json({ error: { message: "Cost sheet not found" } });

    const uploaded = [];
    for (const f of parsed.data.files) {
      const decoded = parseDataUrl(f.dataUrl);
      if (!decoded) return res.status(400).json({ error: { message: `Invalid file data for ${f.fileName}` } });
      if (decoded.buffer.length > 25 * 1024 * 1024) {
        return res.status(400).json({ error: { message: `${f.fileName} exceeds the 25 MB limit` } });
      }
      const url = await uploadToS3(decoded.buffer, f.fileName, decoded.mimeType, "cost-manager");
      uploaded.push({
        fileName: f.fileName,
        url,
        mimeType: decoded.mimeType,
        size: decoded.buffer.length,
        fileType: f.fileType || "other",
        uploadedByUsername: req.user?.username || req.user?.name || "",
        uploadedAt: new Date(),
      });
    }
    item.attachments.push(...uploaded);
    await item.save();

    await writeAudit(req, "cost_line_item", item._id, item.projectId, "update", null, {
      filesAdded: uploaded.map((u) => `${u.fileType}:${u.fileName}`),
    });
    res.status(201).json(await loadSheetPayload(sheet));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/cost-manager/items/:itemId/files/:fileId
router.delete("/items/:itemId/files/:fileId", requireAuth, async (req, res, next) => {
  try {
    if (!requireEditor(req, res)) return;
    const item = await CostLineItem.findById(req.params.itemId);
    if (!item) return res.status(404).json({ error: { message: "Line item not found" } });
    const sheet = await CostSheet.findById(item.costSheetId);
    if (!sheet) return res.status(404).json({ error: { message: "Cost sheet not found" } });

    const file = item.attachments.id(req.params.fileId);
    if (!file) return res.status(404).json({ error: { message: "File not found" } });
    const removed = { fileName: file.fileName, fileType: file.fileType };
    file.deleteOne();
    await item.save();

    await writeAudit(req, "cost_line_item", item._id, item.projectId, "update", { fileRemoved: removed }, null);
    res.json(await loadSheetPayload(sheet));
  } catch (err) {
    next(err);
  }
});

// ---------- inventory records (split locations, QR codes, location finder) ----------

const inventorySchema = z.object({
  locationName: z.string().trim().min(1).max(200),
  address: z.string().max(300).optional(),
  building: z.string().max(120).optional(),
  room: z.string().max(120).optional(),
  aisle: z.string().max(60).optional(),
  shelf: z.string().max(60).optional(),
  bin: z.string().max(60).optional(),
  qtyStored: z.number().min(0).max(1e9).optional(),
  unit: z.string().max(40).optional(),
  notes: z.string().max(1000).optional(),
  photoDataUrl: z.string().optional(),
  markStored: z.boolean().optional(),
});

function inventoryHasExactPlacement(data) {
  return ["building", "room", "aisle", "shelf", "bin"].some((f) => String(data[f] || "").trim().length > 0);
}

function serializeInventoryRecord(r) {
  return {
    id: String(r._id),
    lineItemId: String(r.lineItemId?._id || r.lineItemId),
    projectId: r.projectId,
    locationName: r.locationName,
    address: r.address || "",
    building: r.building || "",
    room: r.room || "",
    aisle: r.aisle || "",
    shelf: r.shelf || "",
    bin: r.bin || "",
    qtyStored: r.qtyStored || 0,
    unit: r.unit || "",
    notes: r.notes || "",
    qrCode: r.qrCode || "",
    photoUrl: r.photoUrl || "",
    storedByUsername: r.storedByUsername || "",
    storedAt: r.createdAt,
  };
}

// GET /api/cost-manager/items/:itemId/inventory
router.get("/items/:itemId/inventory", requireAuth, async (req, res, next) => {
  try {
    const records = await CostInventoryRecord.find({ lineItemId: req.params.itemId })
      .sort({ createdAt: 1 })
      .lean();
    res.json({ items: records.map(serializeInventoryRecord) });
  } catch (err) {
    next(err);
  }
});

// POST /api/cost-manager/items/:itemId/inventory — store (part of) an item at a location.
router.post("/items/:itemId/inventory", requireAuth, async (req, res, next) => {
  try {
    if (!requireEditor(req, res)) return;
    const parsed = inventorySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { message: parsed.error.issues[0]?.message || "Invalid payload" } });
    if (!inventoryHasExactPlacement(parsed.data)) {
      return res.status(400).json({
        error: { message: "An exact placement (building, room, aisle, shelf, or bin) is required." },
      });
    }

    const item = await CostLineItem.findById(req.params.itemId);
    if (!item) return res.status(404).json({ error: { message: "Line item not found" } });
    const sheet = await CostSheet.findById(item.costSheetId);
    if (!sheet) return res.status(404).json({ error: { message: "Cost sheet not found" } });

    const { photoDataUrl, markStored, ...fields } = parsed.data;
    let photoUrl = "";
    if (photoDataUrl) {
      const decoded = parseDataUrl(photoDataUrl);
      if (decoded) photoUrl = await uploadToS3(decoded.buffer, "storage-photo.jpg", decoded.mimeType, "cost-manager");
    }

    const record = await CostInventoryRecord.create({
      ...fields,
      lineItemId: item._id,
      costSheetId: sheet._id,
      projectId: item.projectId,
      unit: fields.unit || item.unit || "",
      qrCode: generateQrCode(),
      photoUrl,
      storedByUserId: req.user?.id || "",
      storedByUsername: req.user?.username || req.user?.name || "",
    });

    // Mirror the first/primary location onto the item and flip it to Stored.
    if (markStored !== false) {
      item.purchaseStatus = "stored";
      item.storage = {
        ...fields,
        qtyStored: fields.qtyStored || 0,
        storedByUsername: record.storedByUsername,
        storedAt: new Date(),
      };
      computeItemTotals(item);
      await item.save();
    }

    await writeAudit(req, "inventory_record", record._id, item.projectId, "create", null, {
      itemName: item.itemName,
      locationName: record.locationName,
      qtyStored: record.qtyStored,
      qrCode: record.qrCode,
    });
    res.status(201).json(await loadSheetPayload(sheet));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/cost-manager/inventory/:recordId
router.delete("/inventory/:recordId", requireAuth, async (req, res, next) => {
  try {
    if (!requireEditor(req, res)) return;
    const record = await CostInventoryRecord.findById(req.params.recordId);
    if (!record) return res.status(404).json({ error: { message: "Inventory record not found" } });
    const sheet = await CostSheet.findById(record.costSheetId);

    await record.deleteOne();
    await writeAudit(req, "inventory_record", record._id, record.projectId, "delete", {
      locationName: record.locationName,
      qrCode: record.qrCode,
    }, null);

    if (!sheet) return res.json({ ok: true });
    res.json(await loadSheetPayload(sheet));
  } catch (err) {
    next(err);
  }
});

// GET /api/cost-manager/inventory?search= — global Location Finder across all projects.
// Matches item name, vendor, project, location name, building, room, aisle, shelf, bin, QR code.
router.get("/inventory", requireAuth, async (req, res, next) => {
  try {
    const search = String(req.query.search || "").trim().toLowerCase();
    const records = await CostInventoryRecord.find({})
      .populate({
        path: "lineItemId",
        select: "itemName purchaseStatus qty unit vendorId",
        populate: { path: "vendorId", select: "name" },
      })
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    const projectIds = [...new Set(records.map((r) => r.projectId).filter(mongoose.isValidObjectId))];
    const projects = await Project.find({ _id: { $in: projectIds } }).select("name").lean();
    const projectNames = new Map(projects.map((p) => [String(p._id), p.name]));

    let results = records
      .filter((r) => r.lineItemId)
      .map((r) => ({
        ...serializeInventoryRecord(r),
        itemName: r.lineItemId.itemName,
        purchaseStatus: r.lineItemId.purchaseStatus,
        vendorName: r.lineItemId.vendorId?.name || "",
        projectName: projectNames.get(String(r.projectId)) || "",
      }));

    if (search) {
      results = results.filter((r) =>
        [r.itemName, r.vendorName, r.projectName, r.locationName, r.address, r.building, r.room, r.aisle, r.shelf, r.bin, r.qrCode]
          .some((v) => String(v || "").toLowerCase().includes(search))
      );
    }

    res.json({ items: results.slice(0, 100) });
  } catch (err) {
    next(err);
  }
});

// ---------- certifications, testing, UL listing, permits ----------

const certSchema = z.object({
  requirementType: z.enum(["lab_testing", "ul_listing", "permit", "certification", "retesting"]),
  name: z.string().trim().min(1).max(300),
  authorityOrLab: z.string().max(300).optional(),
  standard: z.string().max(120).optional(),
  status: z.enum(["planned", "quoted", "submitted", "in_progress", "passed", "failed", "approved", "expired"]).optional(),
  requiredForPrototype: z.boolean().optional(),
  estimatedCostCents: moneyCents.optional(),
  paidCents: moneyCents.optional(),
  dueDate: z.string().nullable().optional(),
  filingDate: z.string().nullable().optional(),
  approvalDate: z.string().nullable().optional(),
  expirationDate: z.string().nullable().optional(),
  result: z.string().max(1000).optional(),
  notes: z.string().max(2000).optional(),
});

const CERT_SECTION_NAME = "Certifications & Permits";
const CERT_EXPENSE_TYPE = {
  lab_testing: "testing",
  ul_listing: "certification",
  permit: "permit",
  certification: "certification",
  retesting: "testing",
};

function parseDateField(v) {
  if (v === null) return null;
  if (v === undefined) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

// Keep the paired cost line item in step so certification costs roll into
// projected prototype cost, spend, and build readiness.
async function syncCertLineItem(req, sheet, cert) {
  let item = cert.lineItemId ? await CostLineItem.findById(cert.lineItemId) : null;
  if (!item) {
    let section = await CostSection.findOne({ costSheetId: sheet._id, name: CERT_SECTION_NAME });
    if (!section) {
      const maxSort = await CostSection.find({ costSheetId: sheet._id }).sort({ sortOrder: -1 }).limit(1).lean();
      section = await CostSection.create({
        costSheetId: sheet._id,
        name: CERT_SECTION_NAME,
        sortOrder: (maxSort[0]?.sortOrder ?? -1) + 1,
      });
    }
    item = new CostLineItem({
      costSheetId: sheet._id,
      costSectionId: section._id,
      projectId: sheet.projectId,
      createdByUserId: req.user?.id || "",
      createdByUsername: req.user?.username || req.user?.name || "",
    });
    cert.lineItemId = item._id;
  }

  item.itemName = cert.name;
  item.expenseType = CERT_EXPENSE_TYPE[cert.requirementType] || "certification";
  item.qty = 1;
  item.unitCostCents = cert.estimatedCostCents || 0;
  item.paidCents = cert.paidCents || 0;
  item.requiredForPrototype = !!cert.requiredForPrototype;
  computeItemTotals(item);
  if (["passed", "approved"].includes(cert.status)) {
    // A completed requirement counts as fully complete for readiness.
    if (item.paidCents >= item.estimatedTotalCents) item.purchaseStatus = "stored";
    else if (item.paidCents > 0) item.purchaseStatus = "partially_paid";
  } else if (item.paidCents >= item.estimatedTotalCents && item.estimatedTotalCents > 0) {
    item.purchaseStatus = "purchased";
  } else if (item.paidCents > 0) {
    item.purchaseStatus = "partially_paid";
  }
  await item.save();
  return item;
}

// POST /api/cost-manager/projects/:projectId/certifications
router.post("/projects/:projectId/certifications", requireAuth, async (req, res, next) => {
  try {
    if (!requireEditor(req, res)) return;
    const parsed = certSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { message: parsed.error.issues[0]?.message || "Invalid payload" } });

    const sheet = await CostSheet.findOne({ projectId: req.params.projectId });
    if (!sheet) return res.status(404).json({ error: { message: "Open the project Cost Manager first to create its cost sheet" } });

    const data = parsed.data;
    const cert = new CertificationRequirement({
      ...data,
      dueDate: parseDateField(data.dueDate) ?? null,
      filingDate: parseDateField(data.filingDate) ?? null,
      approvalDate: parseDateField(data.approvalDate) ?? null,
      expirationDate: parseDateField(data.expirationDate) ?? null,
      projectId: sheet.projectId,
      costSheetId: sheet._id,
      createdByUserId: req.user?.id || "",
      createdByUsername: req.user?.username || req.user?.name || "",
    });
    await syncCertLineItem(req, sheet, cert);
    await cert.save();

    await writeAudit(req, "certification_requirement", cert._id, sheet.projectId, "create", null, {
      name: cert.name,
      requirementType: cert.requirementType,
      estimatedCostCents: cert.estimatedCostCents,
    });
    const payload = await loadSheetPayload(sheet);
    void maybeSendBudgetAlert(req, sheet, payload.summary);
    res.status(201).json(payload);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/cost-manager/certifications/:certId
router.patch("/certifications/:certId", requireAuth, async (req, res, next) => {
  try {
    if (!requireEditor(req, res)) return;
    const parsed = certSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { message: parsed.error.issues[0]?.message || "Invalid payload" } });

    const cert = await CertificationRequirement.findById(req.params.certId);
    if (!cert) return res.status(404).json({ error: { message: "Certification requirement not found" } });
    const sheet = await CostSheet.findById(cert.costSheetId);
    if (!sheet) return res.status(404).json({ error: { message: "Cost sheet not found" } });

    const old = {
      status: cert.status,
      estimatedCostCents: cert.estimatedCostCents,
      paidCents: cert.paidCents,
      name: cert.name,
    };

    const data = { ...parsed.data };
    for (const f of ["dueDate", "filingDate", "approvalDate", "expirationDate"]) {
      if (f in data) {
        const d = parseDateField(data[f]);
        if (d === undefined && data[f] !== null) delete data[f];
        else data[f] = d;
      }
    }
    // A due-date change re-arms the near-deadline alert.
    if ("dueDate" in data) cert.dueAlertSentAt = null;
    Object.assign(cert, data);
    await syncCertLineItem(req, sheet, cert);
    await cert.save();

    await writeAudit(req, "certification_requirement", cert._id, sheet.projectId, "update", old, {
      status: cert.status,
      estimatedCostCents: cert.estimatedCostCents,
      paidCents: cert.paidCents,
      name: cert.name,
    });
    const payload = await loadSheetPayload(sheet);
    void maybeSendBudgetAlert(req, sheet, payload.summary);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/cost-manager/certifications/:certId — removes its paired cost row too.
router.delete("/certifications/:certId", requireAuth, async (req, res, next) => {
  try {
    if (!requireEditor(req, res)) return;
    const cert = await CertificationRequirement.findById(req.params.certId);
    if (!cert) return res.status(404).json({ error: { message: "Certification requirement not found" } });
    const sheet = await CostSheet.findById(cert.costSheetId);

    if (cert.lineItemId) await CostLineItem.deleteOne({ _id: cert.lineItemId });
    await cert.deleteOne();

    await writeAudit(req, "certification_requirement", cert._id, cert.projectId, "delete", { name: cert.name }, null);
    if (!sheet) return res.json({ ok: true });
    res.json(await loadSheetPayload(sheet));
  } catch (err) {
    next(err);
  }
});

// GET /api/cost-manager/projects/:projectId/audit — recent audit trail.
router.get("/projects/:projectId/audit", requireAuth, async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const logs = await CostAuditLog.find({ projectId: String(req.params.projectId) })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    res.json({
      items: logs.map((l) => ({
        id: String(l._id),
        entityType: l.entityType,
        entityId: l.entityId,
        action: l.action,
        username: l.username,
        oldValue: l.oldValue,
        newValue: l.newValue,
        createdAt: l.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
