const express = require("express");
const Website = require("../models/Website");
const Task = require("../models/Task");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// Get all active websites - MUST come before /:id route
router.get("/active", async (req, res, next) => {
  try {
    const websites = await Website.find({ websiteType: "active" })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ items: websites });
  } catch (err) {
    next(err);
  }
});

// Get all future websites - MUST come before /:id route
router.get("/future", async (req, res, next) => {
  try {
    const websites = await Website.find({ websiteType: "future" })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ items: websites });
  } catch (err) {
    next(err);
  }
});

// Get single website by ID
router.get("/:id", async (req, res, next) => {
  try {
    const website = await Website.findById(req.params.id).lean();
    if (!website) {
      return res.status(404).json({ error: { message: "Website not found" } });
    }
    res.json({ item: website });
  } catch (err) {
    next(err);
  }
});

// Create new website (requires auth)
router.post("/", requireAuth, async (req, res, next) => {
  try {
    const { siteName, url, websiteType, ...rest } = req.body;

    if (!siteName || !url || !websiteType) {
      return res.status(400).json({
        error: { message: "siteName, url, and websiteType are required" },
      });
    }

    const newWebsite = new Website({
      siteName,
      url,
      websiteType,
      ...rest,
      createdBy: req.user?.username || "System",
    });

    await newWebsite.save();
    res.status(201).json({ item: newWebsite });
  } catch (err) {
    next(err);
  }
});

// Update website (requires auth)
router.put("/:id", requireAuth, async (req, res, next) => {
  try {
    const { siteName, url, websiteType, ...rest } = req.body;

    const website = await Website.findByIdAndUpdate(
      req.params.id,
      { siteName, url, websiteType, ...rest },
      { new: true, runValidators: true }
    );

    if (!website) {
      return res.status(404).json({ error: { message: "Website not found" } });
    }

    res.json({ item: website });
  } catch (err) {
    next(err);
  }
});

// Delete website (requires auth)
router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const website = await Website.findByIdAndDelete(req.params.id);
    if (!website) {
      return res.status(404).json({ error: { message: "Website not found" } });
    }
    res.json({ message: "Website deleted successfully" });
  } catch (err) {
    next(err);
  }
});

// Convert future website to project task (requires auth)
router.post("/:id/convert-to-task", requireAuth, async (req, res, next) => {
  try {
    const { projectId, title, description, priority, assignees } = req.body;
    if (!projectId) {
      return res.status(400).json({ error: { message: "projectId is required" } });
    }

    const website = await Website.findById(req.params.id);
    if (!website) {
      return res.status(404).json({ error: { message: "Website not found" } });
    }

    if (website.websiteType !== "future") {
      return res.status(400).json({ error: { message: "Only future websites can be launched as tasks" } });
    }

    // Get the current max task number to assign a taskNumber
    const maxTask = await Task.findOne().sort({ taskNumber: -1 }).select("taskNumber").lean();
    const taskNumber = (maxTask?.taskNumber || 0) + 1;

    // Create a new task linked to this website
    const taskTitle = title || `Launch website: ${website.siteName}`;
    const taskDescription = description || `Concept: ${website.concept || "N/A"}\nNotes: ${website.notes || "N/A"}\nDomain: ${website.url}`;
    
    const newTask = new Task({
      title: taskTitle,
      description: taskDescription,
      projectId,
      priority: priority || "medium",
      assignees: Array.isArray(assignees) ? assignees : [],
      status: "pending",
      category: "task",
      websiteId: website._id,
      taskNumber,
      createdBy: {
        userId: String(req.user?.sub || req.user?.id || ""),
        name: String(req.user?.username || req.user?.name || "System"),
        role: String(req.user?.role || ""),
      }
    });

    await newTask.save();

    // Move website type to "in-development"
    website.websiteType = "in-development";
    website.developmentStage = "Development";
    await website.save();

    res.status(201).json({ item: website, task: newTask });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
