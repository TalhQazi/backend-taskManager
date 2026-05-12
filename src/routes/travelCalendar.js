const express = require("express");
const { z } = require("zod");
const TravelCalendar = require("../models/TravelCalendar");
const { requireAuth } = require("../middleware/auth");
const { ROLES, ROLE_GROUPS } = require("../constants/roles");

const router = express.Router();

// Validation schemas
const createTravelSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  startDate: z.string().transform((str) => new Date(str)),
  endDate: z.string().transform((str) => new Date(str)),
  destination: z.string().min(1, "Destination is required"),
  purpose: z.enum(["business", "personal", "conference", "meeting", "training", "other"]).default("business"),
  status: z.enum(["planned", "approved", "in-progress", "completed", "cancelled"]).default("planned"),
  budget: z.object({
    estimated: z.number().default(0),
    actual: z.number().default(0),
    currency: z.string().default("USD"),
  }).optional(),
  notes: z.string().optional(),
  visibility: z.enum(["private", "team", "department", "company"]).default("team"),
});

const updateTravelSchema = createTravelSchema.partial();

// Helper function to get visible travel calendars based on role and user
async function getVisibleTravelCalendars(user, filters = {}) {
  const query = { ...filters };
  
  // If not admin/super-admin, filter by visibility
  if (!ROLE_GROUPS.ALL_ADMIN.includes(user.role)) {
    if (user.role === "manager") {
      // Managers can see their own + team travel calendars
      query.$or = [
        { employee: user._id },
        { visibility: { $in: ["team", "department", "company"] } }
      ];
    } else if (user.role === "employee") {
      // Employees can only see their own + public travel calendars
      query.$or = [
        { employee: user._id },
        { visibility: "company" }
      ];
    }
  }
  
  return TravelCalendar.find(query)
    .populate("employee", "name email")
    .populate("approvedBy", "name email")
    .populate("createdBy", "name email")
    .sort({ startDate: 1 });
}

// GET /api/travel-calendar - Get all visible travel calendars
router.get("/", requireAuth, async (req, res) => {
  try {
    const { startDate, endDate, status, employee, purpose } = req.query;
    const filters = {};
    
    if (startDate || endDate) {
      filters.startDate = {};
      if (startDate) filters.startDate.$gte = new Date(startDate);
      if (endDate) filters.startDate.$lte = new Date(endDate);
    }
    
    if (status) filters.status = status;
    if (employee) filters.employee = employee;
    if (purpose) filters.purpose = purpose;
    
    const travelCalendars = await getVisibleTravelCalendars(req.user, filters);
    
    res.json({
      success: true,
      data: {
        items: travelCalendars,
        total: travelCalendars.length,
      },
    });
  } catch (error) {
    console.error("[TravelCalendar GET] Error:", error);
    res.status(500).json({
      success: false,
      error: { message: "Failed to fetch travel calendars" },
    });
  }
});

// GET /api/travel-calendar/:id - Get specific travel calendar
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const travelCalendar = await TravelCalendar.findById(req.params.id)
      .populate("employee", "name email")
      .populate("approvedBy", "name email")
      .populate("createdBy", "name email")
      .populate("attachments");
    
    if (!travelCalendar) {
      return res.status(404).json({
        success: false,
        error: { message: "Travel calendar not found" },
      });
    }
    
    // Check visibility permissions
    const canAccess = 
      ROLE_GROUPS.ALL_ADMIN.includes(req.user.role) ||
      travelCalendar.employee._id.toString() === req.user._id.toString() ||
      travelCalendar.visibility === "company" ||
      (req.user.role === "manager" && ["team", "department"].includes(travelCalendar.visibility));
    
    if (!canAccess) {
      return res.status(403).json({
        success: false,
        error: { message: "Access denied" },
      });
    }
    
    res.json({
      success: true,
      data: { item: travelCalendar },
    });
  } catch (error) {
    console.error("[TravelCalendar GET by ID] Error:", error);
    res.status(500).json({
      success: false,
      error: { message: "Failed to fetch travel calendar" },
    });
  }
});

// POST /api/travel-calendar - Create new travel calendar
router.post("/", requireAuth, async (req, res) => {
  try {
    const validatedData = createTravelSchema.parse(req.body);
    
    // Create travel calendar
    const travelCalendar = new TravelCalendar({
      ...validatedData,
      employee: req.user._id,
      createdBy: req.user._id,
    });
    
    await travelCalendar.save();
    
    const populatedCalendar = await TravelCalendar.findById(travelCalendar._id)
      .populate("employee", "name email")
      .populate("createdBy", "name email");
    
    res.status(201).json({
      success: true,
      data: { item: populatedCalendar },
      message: "Travel calendar created successfully",
    });
  } catch (error) {
    if (error.name === "ZodError") {
      return res.status(400).json({
        success: false,
        error: { message: error.errors[0]?.message || "Invalid input data" },
      });
    }
    
    console.error("[TravelCalendar POST] Error:", error);
    res.status(500).json({
      success: false,
      error: { message: "Failed to create travel calendar" },
    });
  }
});

// PUT /api/travel-calendar/:id - Update travel calendar
router.put("/:id", requireAuth, async (req, res) => {
  try {
    const travelCalendar = await TravelCalendar.findById(req.params.id);
    
    if (!travelCalendar) {
      return res.status(404).json({
        success: false,
        error: { message: "Travel calendar not found" },
      });
    }
    
    // Check permissions
    const canUpdate = 
      ROLE_GROUPS.ALL_ADMIN.includes(req.user.role) ||
      travelCalendar.employee.toString() === req.user._id.toString();
    
    if (!canUpdate) {
      return res.status(403).json({
        success: false,
        error: { message: "Access denied" },
      });
    }
    
    const validatedData = updateTravelSchema.parse(req.body);
    
    // If status is being changed to 'approved', set approvedBy
    if (validatedData.status === "approved" && travelCalendar.status !== "approved") {
      validatedData.approvedBy = req.user._id;
    }
    
    Object.assign(travelCalendar, validatedData);
    await travelCalendar.save();
    
    const populatedCalendar = await TravelCalendar.findById(travelCalendar._id)
      .populate("employee", "name email")
      .populate("approvedBy", "name email")
      .populate("createdBy", "name email");
    
    res.json({
      success: true,
      data: { item: populatedCalendar },
      message: "Travel calendar updated successfully",
    });
  } catch (error) {
    if (error.name === "ZodError") {
      return res.status(400).json({
        success: false,
        error: { message: error.errors[0]?.message || "Invalid input data" },
      });
    }
    
    console.error("[TravelCalendar PUT] Error:", error);
    res.status(500).json({
      success: false,
      error: { message: "Failed to update travel calendar" },
    });
  }
});

// DELETE /api/travel-calendar/:id - Delete travel calendar
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const travelCalendar = await TravelCalendar.findById(req.params.id);
    
    if (!travelCalendar) {
      return res.status(404).json({
        success: false,
        error: { message: "Travel calendar not found" },
      });
    }
    
    // Check permissions
    const canDelete = 
      ROLE_GROUPS.ALL_ADMIN.includes(req.user.role) ||
      travelCalendar.employee.toString() === req.user._id.toString();
    
    if (!canDelete) {
      return res.status(403).json({
        success: false,
        error: { message: "Access denied" },
      });
    }
    
    await TravelCalendar.findByIdAndDelete(req.params.id);
    
    res.json({
      success: true,
      message: "Travel calendar deleted successfully",
    });
  } catch (error) {
    console.error("[TravelCalendar DELETE] Error:", error);
    res.status(500).json({
      success: false,
      error: { message: "Failed to delete travel calendar" },
    });
  }
});

module.exports = router;
