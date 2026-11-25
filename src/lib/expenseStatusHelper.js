const CostSheet = require("../models/CostSheet");
const CostLineItem = require("../models/CostLineItem");
const ExpenseSheet = require("../models/ExpenseSheet");
const ExpenseItem = require("../models/ExpenseItem");

function computeCostSheetProgress(sheet, items = []) {
  const activeItems = items.filter((i) => i.isActive !== false);
  const included = activeItems.filter((i) => i.purchaseStatus !== "canceled");
  const itemCount = activeItems.length;
  const projectedCents = included.reduce((sum, i) => sum + (i.estimatedTotalCents || 0), 0);
  const spentCents = included.reduce((sum, i) => sum + (i.paidCents || 0), 0);

  const purchasedCount = included.filter((i) =>
    ["purchased", "shipped", "received", "stored"].includes(i.purchaseStatus)
  ).length;

  const isDone =
    sheet.quoteStatus === "accepted" ||
    (included.length > 0 && purchasedCount === included.length);

  const isStarted =
    isDone ||
    itemCount > 0 ||
    spentCents > 0 ||
    sheet.quoteStatus === "submitted";

  const status = isDone ? "done" : isStarted ? "started" : "not-started";

  return {
    itemCount,
    purchasedCount,
    projectedCents,
    spentCents,
    isStarted,
    isDone,
    status,
  };
}

function mergeExpenseStatus(existing, incoming) {
  if (!existing) return incoming;
  const rank = { none: 0, "not-started": 1, started: 2, done: 3 };
  return (rank[incoming.status] || 0) >= (rank[existing.status] || 0) ? incoming : existing;
}

async function getProjectExpenseStatusMap() {
  const [costSheets, legacySheets] = await Promise.all([
    CostSheet.find({ projectId: { $nin: [null, ""] } })
      .select("_id projectId name quoteStatus availableBudgetCents")
      .lean(),
    ExpenseSheet.find({ projectId: { $exists: true, $ne: null } })
      .select("_id projectId title status")
      .lean(),
  ]);

  const costSheetIds = costSheets.map((s) => s._id);
  const legacySheetIds = legacySheets.map((s) => s._id);

  const [costItems, legacyItems] = await Promise.all([
    costSheetIds.length > 0
      ? CostLineItem.find({ costSheetId: { $in: costSheetIds }, isActive: { $ne: false } })
          .select("costSheetId estimatedTotalCents paidCents purchaseStatus isActive")
          .lean()
      : [],
    legacySheetIds.length > 0
      ? ExpenseItem.find({ expenseSheetId: { $in: legacySheetIds } })
          .select("expenseSheetId estimatedTotalCents paidCents purchaseStatus")
          .lean()
      : [],
  ]);

  const itemsByCostSheet = new Map();
  for (const item of costItems) {
    const key = String(item.costSheetId);
    if (!itemsByCostSheet.has(key)) itemsByCostSheet.set(key, []);
    itemsByCostSheet.get(key).push(item);
  }

  const itemsByLegacySheet = new Map();
  for (const item of legacyItems) {
    const key = String(item.expenseSheetId);
    if (!itemsByLegacySheet.has(key)) itemsByLegacySheet.set(key, []);
    itemsByLegacySheet.get(key).push(item);
  }

  const map = new Map();

  for (const sheet of costSheets) {
    const pid = String(sheet.projectId || "").trim();
    if (!pid) continue;
    const progress = computeCostSheetProgress(sheet, itemsByCostSheet.get(String(sheet._id)) || []);
    const candidate = {
      status: progress.status,
      isStarted: progress.isStarted,
      isDone: progress.isDone,
      sheetName: sheet.name || "",
    };
    map.set(pid, mergeExpenseStatus(map.get(pid), candidate));
  }

  for (const sheet of legacySheets) {
    const pid = String(sheet.projectId || "").trim();
    if (!pid) continue;
    const items = itemsByLegacySheet.get(String(sheet._id)) || [];
    const purchased = items.filter((i) =>
      ["purchased", "shipped", "received", "stored"].includes(i.purchaseStatus)
    ).length;
    const isDone = sheet.status === "approved" || (items.length > 0 && purchased === items.length);
    const isStarted = isDone || items.length > 0 || sheet.status === "submitted";
    const status = isDone ? "done" : isStarted ? "started" : "not-started";
    const candidate = {
      status,
      isStarted,
      isDone,
      sheetName: sheet.title || "Expense Sheet",
    };
    map.set(pid, mergeExpenseStatus(map.get(pid), candidate));
  }

  return map;
}

async function getTaskExpenseStatusMap() {
  const costSheets = await CostSheet.find({ taskId: { $nin: [null, ""] } })
    .select("_id taskId name quoteStatus availableBudgetCents")
    .lean();

  const sheetIds = costSheets.map((s) => s._id);
  const costItems =
    sheetIds.length > 0
      ? await CostLineItem.find({ costSheetId: { $in: sheetIds }, isActive: { $ne: false } })
          .select("costSheetId estimatedTotalCents paidCents purchaseStatus isActive")
          .lean()
      : [];

  const itemsBySheet = new Map();
  for (const item of costItems) {
    const key = String(item.costSheetId);
    if (!itemsBySheet.has(key)) itemsBySheet.set(key, []);
    itemsBySheet.get(key).push(item);
  }

  const map = new Map();
  for (const sheet of costSheets) {
    const tid = String(sheet.taskId || "").trim();
    if (!tid) continue;
    const progress = computeCostSheetProgress(sheet, itemsBySheet.get(String(sheet._id)) || []);
    const candidate = {
      status: progress.status,
      isStarted: progress.isStarted,
      isDone: progress.isDone,
      sheetName: sheet.name || "",
    };
    map.set(tid, mergeExpenseStatus(map.get(tid), candidate));
  }

  return map;
}

function matchesExpenseStatusFilter(entry, filterValue) {
  if (!filterValue || filterValue === "all") return true;
  if (filterValue === "done") return Boolean(entry?.isDone);
  if (filterValue === "started") return Boolean(entry?.isStarted || entry?.isDone);
  if (filterValue === "has-sheet") return Boolean(entry);
  if (filterValue === "not-started") return Boolean(entry && !entry.isStarted && !entry.isDone);
  if (filterValue === "none") return !entry;
  return true;
}

module.exports = {
  computeCostSheetProgress,
  getProjectExpenseStatusMap,
  getTaskExpenseStatusMap,
  matchesExpenseStatusFilter,
};
