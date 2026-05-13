const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/auth");

const Property = require("../models/Property");
const Unit = require("../models/Unit");
const AtlasAccount = require("../models/AtlasAccount");
const JournalEntry = require("../models/JournalEntry");
const AtlasTransaction = require("../models/AtlasTransaction");
const Bill = require("../models/Bill");
const Invoice = require("../models/Invoice");
const Tenant = require("../models/Tenant");
const Lease = require("../models/Lease");
const InventoryItem = require("../models/InventoryItem");
const PayrollRecord = require("../models/PayrollRecord");
const Budget = require("../models/Budget");
const FixedAsset = require("../models/FixedAsset");

// Generic CRUD handlers
const handleGet = (Model, populate = "") => async (req, res) => {
  try { const items = await Model.find().populate(populate); res.json({ success: true, items }); } 
  catch (error) { res.status(500).json({ success: false, message: error.message }); }
};
const handlePost = (Model) => async (req, res) => {
  try { const item = new Model(req.body); await item.save(); res.json({ success: true, item }); } 
  catch (error) { res.status(500).json({ success: false, message: error.message }); }
};

// --- CORE ROUTES ---
router.get("/properties", requireAuth, handleGet(Property, "company"));
router.post("/properties", requireAuth, handlePost(Property));
router.get("/units", requireAuth, handleGet(Unit, "property"));
router.post("/units", requireAuth, handlePost(Unit));
router.get("/accounts", requireAuth, handleGet(AtlasAccount, "company"));
router.post("/accounts", requireAuth, handlePost(AtlasAccount));
router.get("/journal", requireAuth, handleGet(JournalEntry, "lines.account"));
router.post("/journal", requireAuth, async (req, res) => {
  try { 
    const item = new JournalEntry({ ...req.body, createdBy: req.user._id }); 
    await item.save(); 
    // Update account balances based on journal lines
    for (const line of req.body.lines) {
      const adjustment = (line.debit || 0) - (line.credit || 0);
      await AtlasAccount.findByIdAndUpdate(line.account, { $inc: { balance: adjustment } });
    }
    res.json({ success: true, item }); 
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});
router.get("/transactions", requireAuth, handleGet(AtlasTransaction, "account property unit"));
router.post("/transactions", requireAuth, handlePost(AtlasTransaction));
router.get("/bills", requireAuth, handleGet(Bill, "vendor items.account"));
router.post("/bills", requireAuth, handlePost(Bill));
router.get("/invoices", requireAuth, handleGet(Invoice, "tenant"));
router.post("/invoices", requireAuth, handlePost(Invoice));
router.get("/tenants", requireAuth, handleGet(Tenant, "company"));
router.post("/tenants", requireAuth, handlePost(Tenant));
router.get("/leases", requireAuth, handleGet(Lease, "tenant property unit"));
router.post("/leases", requireAuth, handlePost(Lease));
router.get("/inventory", requireAuth, handleGet(InventoryItem));
router.post("/inventory", requireAuth, handlePost(InventoryItem));
router.get("/payroll", requireAuth, handleGet(PayrollRecord, "employee"));
router.post("/payroll", requireAuth, handlePost(PayrollRecord));
router.get("/budgets", requireAuth, handleGet(Budget, "account"));
router.post("/budgets", requireAuth, handlePost(Budget));
router.get("/assets", requireAuth, handleGet(FixedAsset));
router.post("/assets", requireAuth, handlePost(FixedAsset));

// --- PHASE 4 ANALYTICAL ROUTES ---

// Profit & Loss Report
router.get("/reports/pl", requireAuth, async (req, res) => {
  try {
    const revenueAccounts = await AtlasAccount.find({ type: "Revenue" });
    const expenseAccounts = await AtlasAccount.find({ type: "Expense" });
    
    const revenue = revenueAccounts.reduce((sum, a) => sum + Math.abs(a.balance), 0);
    const expenses = expenseAccounts.reduce((sum, a) => sum + a.balance, 0);
    
    res.json({
      success: true,
      revenue,
      expenses,
      netProfit: revenue - expenses,
      breakdown: { revenue: revenueAccounts, expenses: expenseAccounts }
    });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// Balance Sheet Report
router.get("/reports/balance-sheet", requireAuth, async (req, res) => {
  try {
    const assets = await AtlasAccount.find({ type: "Asset" });
    const liabilities = await AtlasAccount.find({ type: "Liability" });
    const equity = await AtlasAccount.find({ type: "Equity" });
    
    const totalAssets = assets.reduce((sum, a) => sum + a.balance, 0);
    const totalLiabilities = liabilities.reduce((sum, a) => sum + Math.abs(a.balance), 0);
    const totalEquity = equity.reduce((sum, a) => sum + Math.abs(a.balance), 0);
    
    res.json({
      success: true,
      totalAssets,
      totalLiabilities,
      totalEquity,
      isBalanced: totalAssets === (totalLiabilities + totalEquity),
      assets, liabilities, equity
    });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// Fraud Alerts
router.get("/fraud/alerts", requireAuth, async (req, res) => {
  try {
    // Basic logic: Find duplicate amounts in a short window or unusually high transactions
    const transactions = await AtlasTransaction.find().sort("-createdAt").limit(100);
    const alerts = [];
    
    const amountMap = new Map();
    transactions.forEach(t => {
      if (amountMap.has(t.amount)) {
        const prev = amountMap.get(t.amount);
        if (Math.abs(new Date(t.date) - new Date(prev.date)) < 86400000) { // Same day
          alerts.push({ type: "Duplicate Transaction", message: `Possible duplicate of $${t.amount} found for ${t.description}`, severity: "Medium" });
        }
      }
      amountMap.set(t.amount, t);
      if (t.amount > 10000) {
        alerts.push({ type: "High Value Transaction", message: `Large transaction of $${t.amount} recorded`, severity: "High" });
      }
    });
    
    res.json({ success: true, alerts });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

module.exports = router;
