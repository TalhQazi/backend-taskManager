const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/auth");

const PersonalBudgetProfile = require("../models/PersonalBudgetProfile");
const PersonalBudgetPeriod = require("../models/PersonalBudgetPeriod");
const PersonalBudgetCategory = require("../models/PersonalBudgetCategory");
const PersonalBudgetRecurrence = require("../models/PersonalBudgetRecurrence");
const PersonalBudgetItem = require("../models/PersonalBudgetItem");
const PersonalBudgetIncomeSource = require("../models/PersonalBudgetIncomeSource");
const PersonalBudgetActivityLog = require("../models/PersonalBudgetActivityLog");

// --- Helper Functions ---

// Fetch or create profile and seed categories if new
async function getProfile(userId) {
  let profile = await PersonalBudgetProfile.findOne({ userId });
  if (!profile) {
    profile = new PersonalBudgetProfile({
      userId,
      displayName: "My Personal Budget",
      defaultCurrency: "USD",
      privacyMode: "private",
    });
    await profile.save();

    // Seed default categories
    await seedDefaultCategories(profile._id);
  }
  return profile;
}

// Seed default categories
async function seedDefaultCategories(profileId) {
  const defaultBillCategories = [
    { name: "Rent / Mortgage", color: "#f87171", icon: "Home" },
    { name: "Utilities", color: "#fb923c", icon: "Zap" },
    { name: "Taxes", color: "#facc15", icon: "Percent" },
    { name: "Insurance", color: "#4ade80", icon: "Shield" },
    { name: "Legal / Court", color: "#60a5fa", icon: "Briefcase" },
    { name: "Contractors", color: "#818cf8", icon: "Users" },
    { name: "Subscriptions", color: "#a78bfa", icon: "CreditCard" },
    { name: "Vehicle", color: "#f472b6", icon: "Car" },
    { name: "Food / Household", color: "#fb7185", icon: "ShoppingBag" },
    { name: "Other", color: "#94a3b8", icon: "HelpCircle" },
  ];

  const defaultIncomeCategories = [
    { name: "Payroll", color: "#34d399", icon: "DollarSign" },
    { name: "Rental Income", color: "#059669", icon: "Home" },
    { name: "Business Draw", color: "#2563eb", icon: "ArrowDownCircle" },
    { name: "Commission", color: "#7c3aed", icon: "TrendingUp" },
    { name: "Reimbursement", color: "#db2777", icon: "Receipt" },
    { name: "Other Income", color: "#4b5563", icon: "PlusCircle" },
  ];

  const categories = [
    ...defaultBillCategories.map((c) => ({
      profileId,
      categoryName: c.name,
      categoryType: "bill",
      color: c.color,
      icon: c.icon,
      isDefault: true,
    })),
    ...defaultIncomeCategories.map((c) => ({
      profileId,
      categoryName: c.name,
      categoryType: "income",
      color: c.color,
      icon: c.icon,
      isDefault: true,
    })),
  ];

  await PersonalBudgetCategory.insertMany(categories);
}

// Log actions
async function logActivity(profileId, userId, action, recordType, recordId, oldValue, newValue) {
  try {
    const log = new PersonalBudgetActivityLog({
      profileId,
      userId,
      action,
      recordType,
      recordId,
      oldValue: oldValue ? oldValue.toObject ? oldValue.toObject() : oldValue : null,
      newValue: newValue ? newValue.toObject ? newValue.toObject() : newValue : null,
    });
    await log.save();
  } catch (err) {
    console.error("[PersonalBudget] Failed to write activity log:", err.message);
  }
}

// --- PROFILE ROUTES ---

// Get personal profile details
router.get("/profile", requireAuth, async (req, res, next) => {
  try {
    const profile = await getProfile(req.user._id);
    res.json({ success: true, item: profile });
  } catch (err) {
    next(err);
  }
});

// Update profile config
router.put("/profile", requireAuth, async (req, res, next) => {
  try {
    const profile = await getProfile(req.user._id);
    const { displayName, defaultCurrency, privacyMode } = req.body;
    if (displayName !== undefined) profile.displayName = displayName;
    if (defaultCurrency !== undefined) profile.defaultCurrency = defaultCurrency;
    if (privacyMode !== undefined) profile.privacyMode = privacyMode;
    await profile.save();
    res.json({ success: true, item: profile });
  } catch (err) {
    next(err);
  }
});

// --- PERIOD ROUTES ---

// List all periods
router.get("/periods", requireAuth, async (req, res, next) => {
  try {
    const profile = await getProfile(req.user._id);
    const periods = await PersonalBudgetPeriod.find({ profileId: profile._id }).sort({ year: -1, month: -1 });
    res.json({ success: true, items: periods });
  } catch (err) {
    next(err);
  }
});

// Create/Initialize a monthly period
router.post("/periods", requireAuth, async (req, res, next) => {
  try {
    const profile = await getProfile(req.user._id);
    const { month, year, startingCash, notes } = req.body;

    if (!month || !year) {
      return res.status(400).json({ success: false, message: "Month and year are required" });
    }

    // Check if period already exists
    let period = await PersonalBudgetPeriod.findOne({ profileId: profile._id, month, year });
    if (period) {
      return res.status(400).json({ success: false, message: "This month is already initialized" });
    }

    period = new PersonalBudgetPeriod({
      profileId: profile._id,
      month,
      year,
      startingCash: startingCash || 0,
      notes: notes || "",
    });
    await period.save();

    // Trigger copy-forward logic for recurring items in the new month
    const newPeriodDate = new Date(year, month - 1, 1);
    const recurrences = await PersonalBudgetRecurrence.find({
      profileId: profile._id,
      startDate: { $lte: new Date(year, month - 1, 28) },
      $or: [{ endDate: null }, { endDate: { $gte: newPeriodDate } }],
    });

    for (const rec of recurrences) {
      const latestItem = await PersonalBudgetItem.findOne({
        profileId: profile._id,
        recurrenceId: rec._id,
      }).sort({ dueDate: -1 });

      if (latestItem) {
        const day = rec.dayOfMonth || latestItem.dueDate.getDate();
        const newDueDate = new Date(year, month - 1, Math.min(day, 28));

        const newItem = new PersonalBudgetItem({
          periodId: period._id,
          profileId: profile._id,
          itemType: latestItem.itemType,
          name: latestItem.name,
          categoryId: latestItem.categoryId,
          amountPlanned: latestItem.amountPlanned,
          amountActual: 0,
          dueDate: newDueDate,
          status: latestItem.itemType === "bill" ? "planned" : "expected",
          recurrenceId: rec._id,
          notes: latestItem.notes,
        });
        await newItem.save();
      }
    }

    logActivity(profile._id, req.user._id, "create", "period", period._id, null, period);
    res.json({ success: true, item: period });
  } catch (err) {
    next(err);
  }
});

// Update period notes or status
router.put("/periods/:id", requireAuth, async (req, res, next) => {
  try {
    const profile = await getProfile(req.user._id);
    const period = await PersonalBudgetPeriod.findOne({ _id: req.params.id, profileId: profile._id });
    if (!period) {
      return res.status(404).json({ success: false, message: "Period not found" });
    }

    const oldPeriod = period.toObject ? period.toObject() : { ...period };
    const { status, notes, startingCash } = req.body;

    if (status !== undefined) period.status = status;
    if (notes !== undefined) period.notes = notes;
    if (startingCash !== undefined) period.startingCash = startingCash;

    await period.save();
    logActivity(profile._id, req.user._id, "update", "period", period._id, oldPeriod, period);

    res.json({ success: true, item: period });
  } catch (err) {
    next(err);
  }
});

// --- CATEGORY ROUTES ---

// List all categories
router.get("/categories", requireAuth, async (req, res, next) => {
  try {
    const profile = await getProfile(req.user._id);
    const categories = await PersonalBudgetCategory.find({ profileId: profile._id });
    res.json({ success: true, items: categories });
  } catch (err) {
    next(err);
  }
});

// Create custom category
router.post("/categories", requireAuth, async (req, res, next) => {
  try {
    const profile = await getProfile(req.user._id);
    const { categoryName, categoryType, color, icon } = req.body;

    if (!categoryName || !categoryType) {
      return res.status(400).json({ success: false, message: "Category name and type are required" });
    }

    const category = new PersonalBudgetCategory({
      profileId: profile._id,
      categoryName,
      categoryType,
      color: color || "#cbd5e1",
      icon: icon || "Folder",
      isDefault: false,
    });
    await category.save();

    res.json({ success: true, item: category });
  } catch (err) {
    next(err);
  }
});

// Update category
router.put("/categories/:id", requireAuth, async (req, res, next) => {
  try {
    const profile = await getProfile(req.user._id);
    const category = await PersonalBudgetCategory.findOne({ _id: req.params.id, profileId: profile._id });
    if (!category) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }

    const { categoryName, color, icon } = req.body;
    if (categoryName !== undefined) category.categoryName = categoryName;
    if (color !== undefined) category.color = color;
    if (icon !== undefined) category.icon = icon;

    await category.save();
    res.json({ success: true, item: category });
  } catch (err) {
    next(err);
  }
});

// Delete category
router.delete("/categories/:id", requireAuth, async (req, res, next) => {
  try {
    const profile = await getProfile(req.user._id);
    const category = await PersonalBudgetCategory.findOneAndDelete({ _id: req.params.id, profileId: profile._id });
    if (!category) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }
    res.json({ success: true, message: "Category deleted" });
  } catch (err) {
    next(err);
  }
});

// --- RECURRENCE ROUTES ---

// List recurring rules
router.get("/recurrences", requireAuth, async (req, res, next) => {
  try {
    const profile = await getProfile(req.user._id);
    const recurrences = await PersonalBudgetRecurrence.find({ profileId: profile._id });
    res.json({ success: true, items: recurrences });
  } catch (err) {
    next(err);
  }
});

// --- BUDGET ITEM ROUTES ---

// List items for a period
router.get("/items", requireAuth, async (req, res, next) => {
  try {
    const profile = await getProfile(req.user._id);
    const { periodId } = req.query;

    if (!periodId) {
      return res.status(400).json({ success: false, message: "periodId parameter is required" });
    }

    const items = await PersonalBudgetItem.find({
      profileId: profile._id,
      periodId,
    })
      .populate("categoryId")
      .sort({ sortOrder: 1, dueDate: 1 });

    res.json({ success: true, items });
  } catch (err) {
    next(err);
  }
});

// Add budget item (supports marking as recurring)
router.post("/items", requireAuth, async (req, res, next) => {
  try {
    const profile = await getProfile(req.user._id);
    const {
      periodId,
      itemType,
      name,
      categoryId,
      amountPlanned,
      amountActual,
      dueDate,
      status,
      notes,
      isRecurring,
      frequency,
    } = req.body;

    if (!periodId || !itemType || !name || !categoryId || amountPlanned === undefined || !dueDate) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    let recurrenceId = null;
    if (isRecurring && frequency) {
      const recDay = new Date(dueDate).getDate();
      const recurrence = new PersonalBudgetRecurrence({
        profileId: profile._id,
        frequency,
        dayOfMonth: recDay,
        startDate: new Date(dueDate),
      });
      await recurrence.save();
      recurrenceId = recurrence._id;
    }

    const item = new PersonalBudgetItem({
      periodId,
      profileId: profile._id,
      itemType,
      name,
      categoryId,
      amountPlanned,
      amountActual: amountActual || 0,
      dueDate: new Date(dueDate),
      status: status || (itemType === "bill" ? "planned" : "expected"),
      notes: notes || "",
      recurrenceId,
    });
    await item.save();

    logActivity(profile._id, req.user._id, "create", "item", item._id, null, item);
    res.json({ success: true, item });
  } catch (err) {
    next(err);
  }
});

// Update budget item status or amounts
router.put("/items/:id", requireAuth, async (req, res, next) => {
  try {
    const profile = await getProfile(req.user._id);
    const item = await PersonalBudgetItem.findOne({ _id: req.params.id, profileId: profile._id });
    if (!item) {
      return res.status(404).json({ success: false, message: "Item not found" });
    }

    const oldItem = item.toObject ? item.toObject() : { ...item };
    const { name, categoryId, amountPlanned, amountActual, dueDate, status, notes, sortOrder } = req.body;

    if (name !== undefined) item.name = name;
    if (categoryId !== undefined) item.categoryId = categoryId;
    if (amountPlanned !== undefined) item.amountPlanned = amountPlanned;
    if (amountActual !== undefined) item.amountActual = amountActual;
    if (dueDate !== undefined) item.dueDate = new Date(dueDate);
    if (status !== undefined) item.status = status;
    if (notes !== undefined) item.notes = notes;
    if (sortOrder !== undefined) item.sortOrder = sortOrder;

    await item.save();
    logActivity(profile._id, req.user._id, "update", "item", item._id, oldItem, item);

    res.json({ success: true, item });
  } catch (err) {
    next(err);
  }
});

// Delete budget item
router.delete("/items/:id", requireAuth, async (req, res, next) => {
  try {
    const profile = await getProfile(req.user._id);
    const item = await PersonalBudgetItem.findOneAndDelete({ _id: req.params.id, profileId: profile._id });
    if (!item) {
      return res.status(404).json({ success: false, message: "Item not found" });
    }

    logActivity(profile._id, req.user._id, "delete", "item", item._id, item, null);

    // If it's a recurring item, we can optionally keep the recurrence rule for other months
    // but disassociate it from this deleted item.
    res.json({ success: true, message: "Item deleted successfully" });
  } catch (err) {
    next(err);
  }
});

// --- ACTIVITY LOGS ---

// Get budget activity logs
router.get("/activity-logs", requireAuth, async (req, res, next) => {
  try {
    const profile = await getProfile(req.user._id);
    const logs = await PersonalBudgetActivityLog.find({ profileId: profile._id })
      .sort({ createdAt: -1 })
      .limit(100);
    res.json({ success: true, items: logs });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
