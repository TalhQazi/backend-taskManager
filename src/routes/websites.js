const express = require("express");
const Website = require("../models/Website");
const Task = require("../models/Task");
const ChecklistTemplate = require("../models/ChecklistTemplate");
const ChecklistItem = require("../models/ChecklistItem");
const ChecklistHistory = require("../models/ChecklistHistory");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const CORE_REQ_MAP = {
  stripeIntegration: "Stripe Integration",
  bugReportButton: "Bug Report Button",
  googleMaps: "Google Maps",
  appleMaps: "Apple Maps",
  infoEmailSetup: "info@ Email Setup",
  nathanEmailSetup: "nathan@ Email Setup",
};

async function updateAndGetWebsiteReadinessScore(websiteId) {
  const website = await Website.findById(websiteId);
  if (!website) return 0;

  // If admin has set an explicit override reason and score, preserve override
  if (website.overrideReason && typeof website.readinessScore === "number" && website.readinessScore >= 0) {
    return website.readinessScore;
  }

  const totalItems = await ChecklistItem.countDocuments({ websiteId });
  const completedItems = await ChecklistItem.countDocuments({ websiteId, status: "completed" });
  const readinessScore = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

  if (website.readinessScore !== readinessScore) {
    website.readinessScore = readinessScore;
    await website.save();
  }

  return readinessScore;
}

// Get all active websites - MUST come before /:id route
router.get("/active", async (req, res, next) => {
  try {
    const activeSites = await Website.find({ websiteType: "active" });
    for (const w of activeSites) {
      await updateAndGetWebsiteReadinessScore(w._id);
    }
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
    const futureSites = await Website.find({ websiteType: "future" });
    for (const w of futureSites) {
      await updateAndGetWebsiteReadinessScore(w._id);
    }
    const websites = await Website.find({ websiteType: "future" })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ items: websites });
  } catch (err) {
    next(err);
  }
});

// Get all compliance templates - MUST come before /:id
router.get("/templates", requireAuth, async (req, res, next) => {
  try {
    const templates = await ChecklistTemplate.find().lean();
    res.json({ items: templates });
  } catch (err) {
    next(err);
  }
});

// Get compliance leaderboard - MUST come before /:id
router.get("/compliance/leaderboard", requireAuth, async (req, res, next) => {
  try {
    const completions = await ChecklistItem.aggregate([
      { $match: { status: "completed" } },
      { $group: { _id: "$completedBy", count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    const items = completions
      .filter(c => c._id) // Filter out empty/system completions
      .map(c => ({ username: c._id, count: c.count }));
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

// Get overall compliance reports - MUST come before /:id
router.get("/compliance/reports", requireAuth, async (req, res, next) => {
  try {
    const allWebsites = await Website.find();
    for (const w of allWebsites) {
      await updateAndGetWebsiteReadinessScore(w._id);
    }
    const websites = await Website.find().lean();
    const totalWebsites = websites.length;
    
    // Average readiness score
    const avgScore = totalWebsites > 0
      ? Math.round(websites.reduce((sum, w) => sum + (w.readinessScore || 0), 0) / totalWebsites)
      : 0;

    // Status breakdown (Red: 0-79%, Yellow: 80-99%, Green: 100%)
    let red = 0;
    let yellow = 0;
    let green = 0;
    websites.forEach(w => {
      const score = w.readinessScore || 0;
      if (score >= 100) green++;
      else if (score >= 80) yellow++;
      else red++;
    });

    // Business unit performance aggregation
    const buGroups = {};
    websites.forEach(w => {
      const bu = w.businessUnit || "Marketing";
      if (!buGroups[bu]) {
        buGroups[bu] = { name: bu, totalScore: 0, count: 0 };
      }
      buGroups[bu].totalScore += w.readinessScore || 0;
      buGroups[bu].count++;
    });

    const buPerformance = Object.values(buGroups).map(g => ({
      name: g.name,
      avgScore: Math.round(g.totalScore / g.count),
      count: g.count
    }));

    res.json({
      item: {
        totalWebsites,
        avgScore,
        statusBreakdown: { red, yellow, green },
        buPerformance
      }
    });
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

// Get or lazy-initialize compliance checklist for a website
router.get("/:id/compliance", requireAuth, async (req, res, next) => {
  try {
    const website = await Website.findById(req.params.id);
    if (!website) {
      return res.status(404).json({ error: { message: "Website not found" } });
    }

    let items = await ChecklistItem.find({ websiteId: website._id }).sort({ createdAt: 1 }).lean();

    // Mandatory core compliance items for every website
    const mandatoryItems = [
      { title: "Stripe Integration", category: "Compliance & Integrations", description: "Verify active Stripe payment gateway and webhook handlers.", requiresEvidence: true },
      { title: "Bug Report Button", category: "Compliance & Integrations", description: "Verify functional Bug Report button on the website interface.", requiresEvidence: false },
      { title: "Google Maps", category: "Compliance & Integrations", description: "Verify Google Maps location embed or API integration.", requiresEvidence: false },
      { title: "Apple Maps", category: "Compliance & Integrations", description: "Verify Apple Maps link or MapKit integration.", requiresEvidence: false },
      { title: "info@ Email Setup", category: "Email & Routing", description: "Verify active info@ email account and forwarding for every active website.", requiresEvidence: true },
      { title: "nathan@ Email Setup", category: "Email & Routing", description: "Verify active nathan@ email account and forwarding for every active website.", requiresEvidence: true },
    ];

    // If no items exist, but the website has a complianceTemplate, initialize them!
    if (items.length === 0 && website.complianceTemplate) {
      const template = await ChecklistTemplate.findOne({ key: website.complianceTemplate });
      if (template) {
        const itemsToCreate = [];
        template.categories.forEach(cat => {
          cat.items.forEach(it => {
            itemsToCreate.push({
              websiteId: website._id,
              category: cat.name,
              title: it.title,
              description: it.description,
              requiresEvidence: it.requiresEvidence,
              status: "pending"
            });
          });
        });

        if (itemsToCreate.length > 0) {
          const created = await ChecklistItem.insertMany(itemsToCreate);
          items = created.map(i => i.toObject());
          
          // Log initial creation history
          const initialHistory = new ChecklistHistory({
            websiteId: website._id,
            action: "checklist_initialized",
            notes: `Checklist initialized from template: ${template.name}`,
            userId: req.user?.sub || req.user?.id || "System",
            username: req.user?.username || "System",
            ipAddress: req.ip || req.headers["x-forwarded-for"] || req.socket.remoteAddress || "",
            deviceInfo: req.headers["user-agent"] || ""
          });
          await initialHistory.save();
        }
      }
    }

    // Ensure all mandatory items exist for every website
    const existingTitles = new Set(items.map(i => i.title));
    const missingMandatory = mandatoryItems.filter(m => !existingTitles.has(m.title));
    if (missingMandatory.length > 0) {
      const createdMissing = await ChecklistItem.insertMany(
        missingMandatory.map(m => ({
          websiteId: website._id,
          category: m.category,
          title: m.title,
          description: m.description,
          requiresEvidence: m.requiresEvidence,
          status: "pending"
        }))
      );
      items = [...items, ...createdMissing.map(i => i.toObject())];
    }

    await updateAndGetWebsiteReadinessScore(website._id);
    const updatedWebsite = await Website.findById(website._id).lean();

    res.json({ items, website: updatedWebsite });
  } catch (err) {
    next(err);
  }
});

// Update a specific checklist item
router.put("/:id/compliance/:itemId", requireAuth, async (req, res, next) => {
  try {
    const { status, notes, evidenceUrl, evidenceFile, blockedReason } = req.body;
    
    const item = await ChecklistItem.findById(req.params.itemId);
    if (!item) {
      return res.status(404).json({ error: { message: "Checklist item not found" } });
    }

    // Role verification: Super Admin, Admin, Manager, Team Lead, Developer
    const userRole = req.user?.role || "";
    const authorizedRoles = ["super-admin", "admin", "manager", "team-lead", "developer"];
    if (!authorizedRoles.includes(userRole)) {
      return res.status(403).json({ error: { message: "Unauthorized: only managers, developers, and admins can mark items." } });
    }

    const previousStatus = item.status;
    
    // Check if evidence is required before completing
    if (status === "completed" && item.requiresEvidence && !evidenceUrl && !evidenceFile && !item.evidenceUrl && !item.evidenceFile) {
      return res.status(400).json({ error: { message: "Evidence (Screenshot, log file or URL) is required to complete this item." } });
    }

    // Update item
    if (status !== undefined) {
      item.status = status;
      if (status === "completed") {
        item.completedBy = req.user?.username || "System";
        item.completedAt = new Date();
      } else {
        item.completedBy = "";
        item.completedAt = undefined;
      }
    }
    if (notes !== undefined) item.notes = notes;
    if (evidenceUrl !== undefined) item.evidenceUrl = evidenceUrl;
    if (evidenceFile !== undefined) item.evidenceFile = evidenceFile;
    if (blockedReason !== undefined) item.blockedReason = blockedReason;

    await item.save();

    // Create Audit Log
    const historyLog = new ChecklistHistory({
      websiteId: item.websiteId,
      itemId: item._id,
      action: "item_updated",
      previousState: previousStatus,
      newState: item.status,
      notes: notes || `Checklist item status changed from ${previousStatus} to ${item.status}`,
      userId: req.user?.sub || req.user?.id || "System",
      username: req.user?.username || "System",
      ipAddress: req.ip || req.headers["x-forwarded-for"] || req.socket.remoteAddress || "",
      deviceInfo: req.headers["user-agent"] || ""
    });
    await historyLog.save();

    // Sync to website core requirement field if item matches a core requirement
    for (const [key, title] of Object.entries(CORE_REQ_MAP)) {
      if (item.title === title) {
        await Website.findByIdAndUpdate(item.websiteId, { [key]: item.status });
      }
    }

    // Recalculate Website Readiness Score
    const readinessScore = await updateAndGetWebsiteReadinessScore(item.websiteId);

    res.json({ item, readinessScore });
  } catch (err) {
    next(err);
  }
});

// Admin override of score or status
router.put("/:id/override", requireAuth, async (req, res, next) => {
  try {
    const { overrideReason, readinessScore, status } = req.body;
    
    // Verify admin role
    const userRole = req.user?.role || "";
    if (userRole !== "admin" && userRole !== "super-admin") {
      return res.status(403).json({ error: { message: "Only administrators can override website parameters." } });
    }

    if (!overrideReason) {
      return res.status(400).json({ error: { message: "Override reason is required." } });
    }

    const website = await Website.findById(req.params.id);
    if (!website) {
      return res.status(404).json({ error: { message: "Website not found" } });
    }

    const previousScore = website.readinessScore;
    const previousStatus = website.status;

    if (readinessScore !== undefined) website.readinessScore = Number(readinessScore);
    if (status !== undefined) website.status = status;
    website.overrideReason = overrideReason;

    await website.save();

    // Create Audit Log
    const historyLog = new ChecklistHistory({
      websiteId: website._id,
      action: "admin_override",
      previousState: `Score: ${previousScore}%, Status: ${previousStatus}`,
      newState: `Score: ${website.readinessScore}%, Status: ${website.status}`,
      notes: `Admin Override: ${overrideReason}`,
      userId: req.user?.sub || req.user?.id || "System",
      username: req.user?.username || "System",
      ipAddress: req.ip || req.headers["x-forwarded-for"] || req.socket.remoteAddress || "",
      deviceInfo: req.headers["user-agent"] || ""
    });
    await historyLog.save();

    res.json({ item: website });
  } catch (err) {
    next(err);
  }
});

// Get website audit history
router.get("/:id/history", requireAuth, async (req, res, next) => {
  try {
    const history = await ChecklistHistory.find({ websiteId: req.params.id })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ items: history });
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

    // Sync any updated core requirements to ChecklistItem collection
    for (const [key, title] of Object.entries(CORE_REQ_MAP)) {
      if (req.body[key] !== undefined) {
        const itemStatus = req.body[key] === "completed" ? "completed" : "pending";
        await ChecklistItem.findOneAndUpdate(
          { websiteId: website._id, title },
          { 
            status: itemStatus, 
            completedBy: itemStatus === "completed" ? (req.user?.username || "System") : "", 
            completedAt: itemStatus === "completed" ? new Date() : undefined 
          },
          { upsert: true }
        );
      }
    }

    // Recalculate readiness score
    await updateAndGetWebsiteReadinessScore(website._id);
    const updatedWebsite = await Website.findById(website._id).lean();

    res.json({ item: updatedWebsite });
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
    // Delete checklist items and history linked to this website
    await ChecklistItem.deleteMany({ websiteId: website._id });
    await ChecklistHistory.deleteMany({ websiteId: website._id });

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
