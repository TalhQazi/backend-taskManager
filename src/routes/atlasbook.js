const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/auth");

const Property = require("../models/Property");
const Unit = require("../models/Unit");
const AtlasAccount = require("../models/AtlasAccount");
const JournalEntry = require("../models/JournalEntry");

// Phase 2 Models
const AtlasTransaction = require("../models/AtlasTransaction");
const Bill = require("../models/Bill");
const Invoice = require("../models/Invoice");
const Tenant = require("../models/Tenant");
const Lease = require("../models/Lease");

// --- PHASE 1 ROUTES ---
router.get("/properties", requireAuth, async (req, res) => {
  try { const items = await Property.find().populate("company"); res.json({ success: true, items }); } 
  catch (error) { res.status(500).json({ success: false, message: error.message }); }
});
router.post("/properties", requireAuth, async (req, res) => {
  try { const item = new Property(req.body); await item.save(); res.json({ success: true, item }); } 
  catch (error) { res.status(500).json({ success: false, message: error.message }); }
});
router.get("/units", requireAuth, async (req, res) => {
  try { const items = await Unit.find().populate("property"); res.json({ success: true, items }); } 
  catch (error) { res.status(500).json({ success: false, message: error.message }); }
});
router.post("/units", requireAuth, async (req, res) => {
  try { const item = new Unit(req.body); await item.save(); res.json({ success: true, item }); } 
  catch (error) { res.status(500).json({ success: false, message: error.message }); }
});
router.get("/accounts", requireAuth, async (req, res) => {
  try { const items = await AtlasAccount.find().populate("company"); res.json({ success: true, items }); } 
  catch (error) { res.status(500).json({ success: false, message: error.message }); }
});
router.post("/accounts", requireAuth, async (req, res) => {
  try { const item = new AtlasAccount(req.body); await item.save(); res.json({ success: true, item }); } 
  catch (error) { res.status(500).json({ success: false, message: error.message }); }
});
router.get("/journal", requireAuth, async (req, res) => {
  try { const items = await JournalEntry.find().populate("lines.account"); res.json({ success: true, items }); } 
  catch (error) { res.status(500).json({ success: false, message: error.message }); }
});
router.post("/journal", requireAuth, async (req, res) => {
  try { const item = new JournalEntry({ ...req.body, createdBy: req.user._id }); await item.save(); res.json({ success: true, item }); } 
  catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// --- PHASE 2 ROUTES ---

// Transactions
router.get("/transactions", requireAuth, async (req, res) => {
  try { const items = await AtlasTransaction.find().populate("account property unit"); res.json({ success: true, items }); } 
  catch (error) { res.status(500).json({ success: false, message: error.message }); }
});
router.post("/transactions", requireAuth, async (req, res) => {
  try { const item = new AtlasTransaction(req.body); await item.save(); res.json({ success: true, item }); } 
  catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// Bills (AP)
router.get("/bills", requireAuth, async (req, res) => {
  try { const items = await Bill.find().populate("vendor items.account"); res.json({ success: true, items }); } 
  catch (error) { res.status(500).json({ success: false, message: error.message }); }
});
router.post("/bills", requireAuth, async (req, res) => {
  try { const item = new Bill(req.body); await item.save(); res.json({ success: true, item }); } 
  catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// Invoices (AR)
router.get("/invoices", requireAuth, async (req, res) => {
  try { const items = await Invoice.find().populate("tenant"); res.json({ success: true, items }); } 
  catch (error) { res.status(500).json({ success: false, message: error.message }); }
});
router.post("/invoices", requireAuth, async (req, res) => {
  try { const item = new Invoice(req.body); await item.save(); res.json({ success: true, item }); } 
  catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// Tenants
router.get("/tenants", requireAuth, async (req, res) => {
  try { const items = await Tenant.find().populate("company"); res.json({ success: true, items }); } 
  catch (error) { res.status(500).json({ success: false, message: error.message }); }
});
router.post("/tenants", requireAuth, async (req, res) => {
  try { const item = new Tenant(req.body); await item.save(); res.json({ success: true, item }); } 
  catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// Leases
router.get("/leases", requireAuth, async (req, res) => {
  try { const items = await Lease.find().populate("tenant property unit"); res.json({ success: true, items }); } 
  catch (error) { res.status(500).json({ success: false, message: error.message }); }
});
router.post("/leases", requireAuth, async (req, res) => {
  try { const item = new Lease(req.body); await item.save(); res.json({ success: true, item }); } 
  catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

module.exports = router;
