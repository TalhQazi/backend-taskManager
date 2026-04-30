const express = require("express");
const mongoose = require("mongoose");
const { z } = require("zod");
const ShoppingList = require("../models/ShoppingList");
const ShoppingListItem = require("../models/ShoppingListItem");
const ActivityLog = require("../models/ActivityLog");
const { requireAuth } = require("../middleware/auth");
const { parsePagination, paginatedResponse } = require("../lib/pagination");

const router = express.Router();

// Helper to log activity
async function logActivity(req, action, resourceType, resourceId, resourceName, description) {
  try {
    await ActivityLog.create({
      actorUserId: String(req.user?.sub || req.user?.id || "unknown"),
      actorUsername: String(req.user?.username || req.user?.name || "unknown"),
      actorRole: String(req.user?.role || "unknown"),
      action,
      resourceType,
      resourceId: String(resourceId || ""),
      resourceName: String(resourceName || ""),
      description: String(description || ""),
      ipAddress: String(req.ip || req.headers["x-forwarded-for"] || ""),
      userAgent: String(req.headers["user-agent"] || ""),
      metadata: { body: req.body },
    });
  } catch (err) {
    console.error("Failed to log activity:", err);
  }
}

// Schema for list creation/update
const shoppingListSchema = z.object({
  name: z.string().min(1, "Name is required"),
  companyId: z.string().optional(),
  locationId: z.string().optional(),
  projectId: z.string().optional(),
  assignedEmployeeId: z.string().optional(),
  vendors: z.array(z.string()).optional().default([]),
  notes: z.string().optional().default(""),
  status: z.enum(["open", "completed", "archived"]).optional().default("open"),
});

// Schema for item creation/update
const shoppingListItemSchema = z.object({
  name: z.string().min(1, "Item name is required"),
  quantity: z.string().optional().default("1"),
  vendorId: z.string().optional(),
  category: z.string().optional().default("General"),
  priority: z.enum(["low", "medium", "high"]).optional().default("medium"),
  notes: z.string().optional().default(""),
  isPurchased: z.boolean().optional().default(false),
  aisle: z.string().optional().default(""),
});

// GET /api/shopping-lists
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const role = String(req.user?.role || "").toLowerCase();
    const userId = String(req.user?.sub || req.user?.id || "");

    const query = {};

    // Visibility Rule: Only assigned employee + admins can view
    if (role !== "admin" && role !== "super-admin" && role !== "manager") {
      query.assignedEmployeeId = userId;
    }

    // Filters
    if (req.query.status) query.status = req.query.status;
    if (req.query.companyId) query.companyId = req.query.companyId;
    if (req.query.locationId) query.locationId = req.query.locationId;
    if (req.query.projectId) query.projectId = req.query.projectId;

    const items = await ShoppingList.find(query)
      .populate("companyId", "name")
      .populate("locationId", "name")
      .populate("projectId", "name")
      .populate("assignedEmployeeId", "name username")
      .populate("vendors", "name")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await ShoppingList.countDocuments(query);

    return res.json(paginatedResponse(items.map(i => ({ ...i, id: i._id })), total, page, limit));
  } catch (err) {
    next(err);
  }
});

// POST /api/shopping-lists
router.post("/", requireAuth, async (req, res, next) => {
  try {
    const parsed = shoppingListSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload", details: parsed.error.errors } });
    }

    const data = {
      ...parsed.data,
      createdBy: req.user?.sub || req.user?.id,
    };

    const list = await ShoppingList.create(data);

    await logActivity(req, "SHOPPING_LIST_CREATE", "shopping_list", list._id, list.name, `Created shopping list: ${list.name}`);

    return res.status(201).json({ item: { ...list.toObject(), id: list._id } });
  } catch (err) {
    next(err);
  }
});

// GET /api/shopping-lists/:id
router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const list = await ShoppingList.findById(req.params.id)
      .populate("companyId", "name")
      .populate("locationId", "name")
      .populate("projectId", "name")
      .populate("assignedEmployeeId", "name username")
      .populate("vendors", "name")
      .lean();

    if (!list) return res.status(404).json({ error: { message: "List not found" } });

    // Auth check
    const role = String(req.user?.role || "").toLowerCase();
    const userId = String(req.user?.sub || req.user?.id || "");
    if (role !== "admin" && role !== "super-admin" && role !== "manager" && String(list.assignedEmployeeId?._id || list.assignedEmployeeId) !== userId) {
      return res.status(403).json({ error: { message: "Access denied" } });
    }

    const items = await ShoppingListItem.find({ shoppingListId: list._id })
      .populate("vendorId", "name")
      .sort({ isPurchased: 1, createdAt: -1 })
      .lean();

    return res.json({ 
      item: { 
        ...list, 
        id: list._id,
        items: items.map(i => ({ ...i, id: i._id }))
      } 
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/shopping-lists/:id
router.put("/:id", requireAuth, async (req, res, next) => {
  try {
    const parsed = shoppingListSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload", details: parsed.error.errors } });
    }

    const list = await ShoppingList.findByIdAndUpdate(req.params.id, { $set: parsed.data }, { new: true });
    if (!list) return res.status(404).json({ error: { message: "List not found" } });

    await logActivity(req, "SHOPPING_LIST_UPDATE", "shopping_list", list._id, list.name, `Updated shopping list: ${list.name}`);

    return res.json({ item: { ...list.toObject(), id: list._id } });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/shopping-lists/:id
router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const list = await ShoppingList.findByIdAndDelete(req.params.id);
    if (!list) return res.status(404).json({ error: { message: "List not found" } });

    // Clean up items
    await ShoppingListItem.deleteMany({ shoppingListId: req.params.id });

    await logActivity(req, "SHOPPING_LIST_DELETE", "shopping_list", list._id, list.name, `Deleted shopping list: ${list.name}`);

    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Items CRUD
router.post("/:id/items", requireAuth, async (req, res, next) => {
  try {
    const parsed = shoppingListItemSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload", details: parsed.error.errors } });
    }

    const data = {
      ...parsed.data,
      shoppingListId: req.params.id,
    };

    const item = await ShoppingListItem.create(data);

    return res.status(201).json({ item: { ...item.toObject(), id: item._id } });
  } catch (err) {
    next(err);
  }
});

router.put("/items/:itemId", requireAuth, async (req, res, next) => {
  try {
    const parsed = shoppingListItemSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload", details: parsed.error.errors } });
    }

    const updateData = { ...parsed.data };
    if (updateData.isPurchased === true) {
      updateData.purchasedAt = new Date();
    } else if (updateData.isPurchased === false) {
      updateData.purchasedAt = null;
    }

    const item = await ShoppingListItem.findByIdAndUpdate(req.params.itemId, { $set: updateData }, { new: true });
    if (!item) return res.status(404).json({ error: { message: "Item not found" } });

    return res.json({ item: { ...item.toObject(), id: item._id } });
  } catch (err) {
    next(err);
  }
});

router.delete("/items/:itemId", requireAuth, async (req, res, next) => {
  try {
    const item = await ShoppingListItem.findByIdAndDelete(req.params.itemId);
    if (!item) return res.status(404).json({ error: { message: "Item not found" } });

    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
