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

// Phase 3 Models
const InventoryItem = require("../models/InventoryItem");
const PayrollRecord = require("../models/PayrollRecord");
const Budget = require("../models/Budget");
const FixedAsset = require("../models/FixedAsset");

// Generic CRUD handlers (keeping it clean)
const handleGet = (Model, populate = "") => async (req, res) => {
  try { const items = await Model.find().populate(populate); res.json({ success: true, items }); } 
  catch (error) { res.status(500).json({ success: false, message: error.message }); }
};
const handlePost = (Model) => async (req, res) => {
  try { const item = new Model(req.body); await item.save(); res.json({ success: true, item }); } 
  catch (error) { res.status(500).json({ success: false, message: error.message }); }
};

// Phase 1 & 2
router.get("/properties", requireAuth, handleGet(Property, "company"));
router.post("/properties", requireAuth, handlePost(Property));
router.get("/units", requireAuth, handleGet(Unit, "property"));
router.post("/units", requireAuth, handlePost(Unit));
router.get("/accounts", requireAuth, handleGet(AtlasAccount, "company"));
router.post("/accounts", requireAuth, handlePost(AtlasAccount));
router.get("/journal", requireAuth, handleGet(JournalEntry, "lines.account"));
router.post("/journal", requireAuth, async (req, res) => {
  try { const item = new JournalEntry({ ...req.body, createdBy: req.user._id }); await item.save(); res.json({ success: true, item }); } 
  catch (error) { res.status(500).json({ success: false, message: error.message }); }
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

// --- PHASE 3 ROUTES ---

// Inventory
router.get("/inventory", requireAuth, handleGet(InventoryItem));
router.post("/inventory", requireAuth, handlePost(InventoryItem));

// Payroll
router.get("/payroll", requireAuth, handleGet(PayrollRecord, "employee"));
router.post("/payroll", requireAuth, handlePost(PayrollRecord));

// Budgets
router.get("/budgets", requireAuth, handleGet(Budget, "account"));
router.post("/budgets", requireAuth, handlePost(Budget));

// Fixed Assets
router.get("/assets", requireAuth, handleGet(FixedAsset));
router.post("/assets", requireAuth, handlePost(FixedAsset));

module.exports = router;
