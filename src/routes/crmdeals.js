const express = require("express");
const { z } = require("zod");

const CRMDeal = require("../models/CRMDeal");
const { requireAuth, requireRole } = require("../middleware/auth");
const { parsePagination, paginatedResponse } = require("../lib/pagination");

const router = express.Router();

const createSchema = z.object({
  name: z.string().min(1),
  company: z.string().min(1),
  value: z.number().positive(),
  stage: z.enum(["Qualification", "Needs Analysis", "Proposal", "Negotiation", "Closed Won", "Closed Lost"]).optional().default("Qualification"),
  probability: z.number().min(0).max(100).optional().default(50),
  closeDate: z.union([z.string(), z.date()]),
  owner: z.string().optional().default("Unassigned"),
});

const updateSchema = createSchema.partial();

function withId(doc) {
  if (!doc) return doc;
  return { ...doc, id: String(doc._id) };
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\$&");
}

// GET /api/crm-deals - List deals with pagination, search, filter
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const { page, limit, search, stage, owner } = req.query;

    const query = {};

    // Search filter - search across name, company, owner
    if (search) {
      const regex = new RegExp(escapeRegExp(search), "i");
      query.$or = [
        { name: regex },
        { company: regex },
        { owner: regex },
      ];
    }

    // Stage filter
    if (stage) {
      query.stage = stage;
    }

    // Owner filter
    if (owner) {
      query.owner = new RegExp(escapeRegExp(owner), "i");
    }

    const { skip, limit: lim } = parsePagination(page, limit);

    const [items, total] = await Promise.all([
      CRMDeal.find(query).sort({ createdAt: -1 }).skip(skip).limit(lim).lean(),
      CRMDeal.countDocuments(query),
    ]);

    // Calculate pipeline metrics
    const allDeals = await CRMDeal.find({}).lean();
    const totalValue = allDeals.reduce((sum, deal) => sum + deal.value, 0);
    const weightedValue = allDeals.reduce((sum, deal) => sum + (deal.value * deal.probability / 100), 0);
    const wonDeals = allDeals.filter(deal => deal.stage === "Closed Won").length;
    const activeDeals = allDeals.filter(deal => !["Closed Won", "Closed Lost"].includes(deal.stage)).length;

    const response = paginatedResponse(items.map(withId), total, page, lim);
    response.metrics = { totalValue, weightedValue, wonDeals, activeDeals };

    res.json(response);
  } catch (error) {
    next(error);
  }
});

// POST /api/crm-deals - Create deal
router.post("/", requireAuth, async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const deal = new CRMDeal(data);
    await deal.save();
    res.status(201).json({ item: withId(deal.toObject()) });
  } catch (error) {
    next(error);
  }
});

// PUT /api/crm-deals/:id - Update deal
router.put("/:id", requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const data = updateSchema.parse(req.body);
    const deal = await CRMDeal.findByIdAndUpdate(id, data, { new: true }).lean();
    if (!deal) {
      return res.status(404).json({ error: { message: "Deal not found" } });
    }
    res.json({ item: withId(deal) });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/crm-deals/:id - Delete deal
router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const deal = await CRMDeal.findByIdAndDelete(id);
    if (!deal) {
      return res.status(404).json({ error: { message: "Deal not found" } });
    }
    res.json({ message: "Deal deleted successfully" });
  } catch (error) {
    next(error);
  }
});

module.exports = router;