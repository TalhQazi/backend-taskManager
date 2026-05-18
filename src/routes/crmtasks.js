const express = require("express");
const { z } = require("zod");

const CRMTask = require("../models/CRMTask");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

const createSchema = z.object({
  title: z.string().min(1, "Task title is required"),
  type: z.enum(["Follow-up Call", "Meeting", "Reminder"]),
  assignedTo: z.string().default("Unassigned"),
  dueDate: z.string().refine((date) => !isNaN(Date.parse(date)), "Invalid date format"),
  priority: z.enum(["Low", "Medium", "High", "Urgent"]).default("Medium"),
  linkedEntity: z.string().optional(),
  status: z.enum(["Pending", "Completed"]).default("Pending"),
});

const updateSchema = createSchema.partial();

function withId(doc) {
  if (!doc) return doc;
  const obj = doc.toObject ? doc.toObject() : doc;
  const { _id, __v, ...rest } = obj;
  return { ...rest, id: String(_id) };
}

// Get all CRM tasks with search and filters
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const { search, type, priority, assignee, status } = req.query;
    
    let query = {};
    
    // Search filter (title, assignedTo, linkedEntity)
    if (search) {
      const searchRegex = new RegExp(search, "i");
      query.$or = [
        { title: searchRegex },
        { assignedTo: searchRegex },
        { linkedEntity: searchRegex },
      ];
    }
    
    // Type filter
    if (type && type !== "All") {
      query.type = type;
    }
    
    // Priority filter
    if (priority && priority !== "All") {
      query.priority = priority;
    }
    
    // Assignee filter
    if (assignee && assignee !== "All") {
      query.assignedTo = assignee;
    }
    
    // Status filter
    if (status && status !== "All") {
      query.status = status;
    }
    
    const items = await CRMTask.find(query)
      .sort({ dueDate: 1, createdAt: -1 })
      .lean();
    
    res.json({ items: items.map(withId) });
  } catch (err) {
    next(err);
  }
});

// Get CRM task by ID
router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const item = await CRMTask.findById(req.params.id).lean();
    if (!item) {
      return res.status(404).json({ error: { message: "CRM task not found" } });
    }
    res.json({ item: withId(item) });
  } catch (err) {
    next(err);
  }
});

// Create CRM task
router.post("/", requireAuth, async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ 
        error: { message: parsed.error.errors[0]?.message || "Invalid payload" } 
      });
    }

    // Convert dueDate string to Date object
    const taskData = {
      ...parsed.data,
      dueDate: new Date(parsed.data.dueDate),
      createdBy: req.user?.id,
    };

    const created = await CRMTask.create(taskData);

    return res.status(201).json({ item: withId(created) });
  } catch (err) {
    return next(err);
  }
});

// Update CRM task
router.put("/:id", requireAuth, async (req, res, next) => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ 
        error: { message: parsed.error.errors[0]?.message || "Invalid payload" } 
      });
    }

    const patch = { ...parsed.data, updatedBy: req.user?.id };

    // Convert dueDate string to Date object if present
    if (patch.dueDate) {
      patch.dueDate = new Date(patch.dueDate);
    }

    const updated = await CRMTask.findByIdAndUpdate(req.params.id, patch, {
      new: true,
    }).lean();

    if (!updated) {
      return res.status(404).json({ error: { message: "CRM task not found" } });
    }

    return res.json({ item: withId(updated) });
  } catch (err) {
    return next(err);
  }
});

// Delete CRM task
router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const deleted = await CRMTask.findByIdAndDelete(req.params.id).lean();
    if (!deleted) {
      return res.status(404).json({ error: { message: "CRM task not found" } });
    }
    res.json({ item: withId(deleted) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
