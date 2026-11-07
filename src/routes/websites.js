const express = require("express");
const Website = require("../models/Website");
const Task = require("../models/Task");
const ChecklistTemplate = require("../models/ChecklistTemplate");
const ChecklistItem = require("../models/ChecklistItem");
const ChecklistHistory = require("../models/ChecklistHistory");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const CORE_REQ_MAP = {
  googleAnalytics: "Google Analytics",
  stripeIntegration: "Stripe Integration",
  bugReportButton: "Bug Report Button",
  googleMaps: "Google Maps",
  appleMaps: "Apple Maps",
  infoEmailSetup: "info@ Email Setup",
  nathanEmailSetup: "nathan@ Email Setup",
  largeHeaderImage: "Large Header Image",
  contactInfoSection: "Contact Info Section",
  adaCompliance: "ADA Compliance",
  faq: "FAQ",
  contactUsPage: "Contact Us Page",
  privacyPolicy: "Privacy Policy",
  seo: "SEO",
  siteMap: "Site Map",
  humanVerification: "Human Verification (Math Puzzle)",
  youtubeCompliance: "YouTube",
  rumbleCompliance: "Rumble",
  libertySocialCompliance: "Liberty Social",
  facebookCompliance: "Facebook",
  xCompliance: "X",
  instagramCompliance: "Instagram",
  tikTokCompliance: "Tik Tok",
  yelpCompliance: "Yelp",
  truthSocialCompliance: "Truth Social",
  threadsCompliance: "Threads",
};

const SOCIAL_MEDIA_ITEMS = [
  { title: "YouTube", category: "Social Media", description: "Official YouTube brand channel and video embeds.", requiresEvidence: false },
  { title: "Facebook", category: "Social Media", description: "Official Facebook brand page and meta integrations.", requiresEvidence: false },
  { title: "X", category: "Social Media", description: "Official X (Twitter) profile handle and social cards.", requiresEvidence: false },
  { title: "Liberty Social", category: "Social Media", description: "Official Liberty Social brand account.", requiresEvidence: false },
  { title: "Rumble", category: "Social Media", description: "Official Rumble channel and video integrations.", requiresEvidence: false },
  { title: "Tik Tok", category: "Social Media", description: "Official TikTok profile and embeds.", requiresEvidence: false },
  { title: "Instagram", category: "Social Media", description: "Official Instagram business handle and grid.", requiresEvidence: false },
  { title: "Threads", category: "Social Media", description: "Official Threads brand account.", requiresEvidence: false },
];

const MOBILE_APP_ITEMS = [
  { title: "iOS App Store Deployment", category: "Mobile App", description: "Publish, verify, and link official Apple App Store mobile application.", requiresEvidence: false },
  { title: "Google Play Store Deployment", category: "Mobile App", description: "Publish, verify, and link official Google Play Store mobile application.", requiresEvidence: false },
  { title: "Mobile App Responsiveness Review", category: "Mobile App", description: "Verify responsive mobile app layout on iOS and Android devices.", requiresEvidence: false },
  { title: "Push Notifications Setup", category: "Mobile App", description: "Verify mobile push notification certificates and tokens.", requiresEvidence: false },
];

const STANDARD_PROJECT_CATEGORIES = [
  {
    name: "Domain & DNS",
    items: [
      { title: "Point Domain DNS", description: "Point A/CNAME records to the production hosting provider.", requiresEvidence: true },
      { title: "SSL / HTTPS Certificate", description: "Verify active HTTPS/SSL certificate for the main domain and subdomains.", requiresEvidence: true },
    ],
  },
  {
    name: "Security",
    items: [
      { title: "HTTPS Redirect", description: "Ensure HTTP calls redirect automatically to secure HTTPS.", requiresEvidence: false },
      { title: "Spam Protection on Contact Forms", description: "Configure reCAPTCHA, Cloudflare Turnstile, or honeypots to block spam entries.", requiresEvidence: false },
    ],
  },
  {
    name: "Analytics & SEO",
    items: [
      { title: "Google Analytics Tracking", description: "Install Google Analytics / GA4 tracking tags.", requiresEvidence: true },
      { title: "SEO Meta Tag Audit", description: "Audit titles, descriptions, and keywords across all pages.", requiresEvidence: false },
      { title: "XML Sitemap & Robots.txt", description: "Verify generation of sitemap.xml and configuration of robots.txt.", requiresEvidence: false },
    ],
  },
  {
    name: "Social Media",
    items: SOCIAL_MEDIA_ITEMS,
  },
  {
    name: "Mobile App",
    items: MOBILE_APP_ITEMS,
  },
  {
    name: "QA Testing",
    items: [
      { title: "Contact Form QA", description: "Submit test inquiries on all forms and verify delivery to notification emails.", requiresEvidence: true },
      { title: "Page Speed Audit", description: "Run Lighthouse test and ensure performance score is above 80.", requiresEvidence: true },
    ],
  },
  {
    name: "Compliance & Integrations",
    items: [
      { title: "Privacy Policy & Terms Links", description: "Add required legal footer links to the layout.", requiresEvidence: false },
      { title: "Cookie Consent Banner", description: "Render standard GDPR/CCPA cookie notification banner.", requiresEvidence: false },
      { title: "Stripe Integration", description: "Verify active Stripe payment gateway and webhook handlers.", requiresEvidence: true },
      { title: "Bug Report Button", description: "Verify functional Bug Report button on the website interface.", requiresEvidence: false },
      { title: "Google Maps", description: "Verify Google Maps location embed or API integration.", requiresEvidence: false },
      { title: "Apple Maps", description: "Verify Apple Maps link or MapKit integration.", requiresEvidence: false },
      { title: "info@ Email Setup", description: "Verify active info@ email account and forwarding.", requiresEvidence: true },
      { title: "nathan@ Email Setup", description: "Verify active nathan@ email account and forwarding.", requiresEvidence: true },
    ],
  },
  {
    name: "Launch Approval",
    items: [
      { title: "Executive Stakeholder Sign-Off", description: "Obtain formal launch approval from marketing lead or business unit owner.", requiresEvidence: true },
    ],
  },
];

function matchCoreReqKey(title) {
  const t = String(title || "").trim().toLowerCase();
  if (t === "youtube") return "youtubeCompliance";
  if (t === "facebook") return "facebookCompliance";
  if (t === "x" || t === "x (twitter)" || t === "twitter") return "xCompliance";
  if (t === "liberty social") return "libertySocialCompliance";
  if (t === "rumble") return "rumbleCompliance";
  if (t === "tik tok" || t === "tiktok") return "tikTokCompliance";
  if (t === "instagram") return "instagramCompliance";
  if (t === "threads") return "threadsCompliance";
  if (t === "yelp") return "yelpCompliance";
  if (t === "truth social") return "truthSocialCompliance";
  if (t === "google analytics") return "googleAnalytics";
  if (t === "stripe integration") return "stripeIntegration";
  if (t === "bug report button") return "bugReportButton";
  if (t === "google maps") return "googleMaps";
  if (t === "apple maps") return "appleMaps";
  if (t.startsWith("info@")) return "infoEmailSetup";
  if (t.startsWith("nathan@")) return "nathanEmailSetup";
  if (t === "human verification (math puzzle)" || t === "human verification") return "humanVerification";
  if (t === "large header image") return "largeHeaderImage";
  if (t === "contact info section") return "contactInfoSection";
  if (t === "ada compliance") return "adaCompliance";
  if (t === "faq") return "faq";
  if (t === "contact us page") return "contactUsPage";
  if (t === "privacy policy") return "privacyPolicy";
  if (t === "seo") return "seo";
  if (t === "site map") return "siteMap";
  return null;
}

async function initializeWebsiteChecklist(websiteId, username = "System") {
  const existing = await ChecklistItem.countDocuments({ websiteId });
  if (existing > 0) return;

  const itemsToCreate = [];
  STANDARD_PROJECT_CATEGORIES.forEach(cat => {
    cat.items.forEach(it => {
      itemsToCreate.push({
        websiteId,
        category: cat.name,
        title: it.title,
        description: it.description || "",
        requiresEvidence: Boolean(it.requiresEvidence),
        status: "pending",
      });
    });
  });

  if (itemsToCreate.length > 0) {
    await ChecklistItem.insertMany(itemsToCreate);
    const initialHistory = new ChecklistHistory({
      websiteId,
      action: "checklist_initialized",
      notes: "Auto-created standard project categories (Social Media, Mobile App, QA, Security, Compliance)",
      userId: username,
      username,
    });
    await initialHistory.save();
  }
}


function coreStatusToChecklistStatus(val) {
  if (val === "green" || val === "completed" || val === "passed") return "completed";
  if (val === "red" || val === "blocked" || val === "failed") return "blocked";
  if (val === "na") return "na";
  return "pending";
}

function checklistStatusToCoreStatus(status) {
  if (status === "completed" || status === "green" || status === "passed") return "green";
  if (status === "blocked" || status === "red" || status === "failed") return "red";
  if (status === "na") return "na";
  return "none";
}

async function updateAndGetWebsiteReadinessScore(websiteId) {
  const website = await Website.findById(websiteId);
  if (!website) return 0;

  // If admin has set an explicit override reason and score, preserve override
  if (website.overrideReason && typeof website.readinessScore === "number" && website.readinessScore >= 0) {
    return website.readinessScore;
  }

  let totalItems = await ChecklistItem.countDocuments({ websiteId });

  if (totalItems === 0) {
    const coreKeys = Object.keys(CORE_REQ_MAP);
    const completedCount = coreKeys.filter(k => website[k] === "green" || website[k] === "completed" || website[k] === "na").length;
    const readinessScore = Math.round((completedCount / coreKeys.length) * 100);
    if (website.readinessScore !== readinessScore) {
      website.readinessScore = readinessScore;
      await website.save();
    }
    return readinessScore;
  }

  const completedItems = await ChecklistItem.countDocuments({
    websiteId,
    status: { $in: ["completed", "green", "passed", "na"] },
  });

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
      .populate('locations')
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
      .populate('locations')
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

// Get all recent compliance audit logs across websites (accountability feed)
router.get("/compliance/audit-logs", requireAuth, async (req, res, next) => {
  try {
    const logs = await ChecklistHistory.find({})
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    
    // Attach website name to each log
    const siteIds = Array.from(new Set(logs.map(l => l.websiteId).filter(Boolean)));
    const sites = await Website.find({ _id: { $in: siteIds } }).select("siteName url").lean();
    const siteMap = {};
    for (const s of sites) {
      siteMap[String(s._id)] = s;
    }

    const enhanced = logs.map(l => ({
      ...l,
      websiteName: siteMap[String(l.websiteId)]?.siteName || "Website",
      websiteUrl: siteMap[String(l.websiteId)]?.url || ""
    }));

    res.json({ items: enhanced });
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
    const websites = await Website.find().populate('locations').lean();
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
    const website = await Website.findById(req.params.id).populate('locations').lean();
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

    // Ensure all standard & mandatory items exist for every website
    const existingTitles = new Set(items.map(i => String(i.title || "").toLowerCase().trim()));
    const allExpectedItems = [...mandatoryItems, ...SOCIAL_MEDIA_ITEMS, ...MOBILE_APP_ITEMS];
    const missingExpected = allExpectedItems.filter(m => !existingTitles.has(String(m.title).toLowerCase().trim()));

    if (missingExpected.length > 0) {
      const createdMissing = await ChecklistItem.insertMany(
        missingExpected.map(m => ({
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
    const updatedWebsite = await Website.findById(website._id).populate('locations').lean();

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
      if (status === "completed" || status === "na") {
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
    const matchedKey = matchCoreReqKey(item.title);
    if (matchedKey) {
      const coreVal = checklistStatusToCoreStatus(item.status);
      await Website.findByIdAndUpdate(item.websiteId, { [matchedKey]: coreVal });
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

    // Auto-create standard project categories (Social Media, Mobile App, QA, Security, etc.)
    await initializeWebsiteChecklist(newWebsite._id, req.user?.username || "System");
    await updateAndGetWebsiteReadinessScore(newWebsite._id);
    const populated = await Website.findById(newWebsite._id).populate('locations').lean();

    res.status(201).json({ item: populated });
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

    // Sync any updated core requirements to ChecklistItem collection and log accountability
    const updaterName = String(req.user?.username || req.user?.name || "System");
    const updaterId = String(req.user?.sub || req.user?.id || "System");

    for (const [key, title] of Object.entries(CORE_REQ_MAP)) {
      if (req.body[key] !== undefined) {
        const itemStatus = coreStatusToChecklistStatus(req.body[key]);
        const isChecked = itemStatus === "completed" || itemStatus === "na" || itemStatus === "blocked";
        
        let titleCondition = { $eq: title };
        if (title === "X") {
          titleCondition = { $in: ["X", "X (Twitter)"] };
        } else if (title === "Tik Tok") {
          titleCondition = { $in: ["Tik Tok", "TikTok"] };
        }

        await ChecklistItem.findOneAndUpdate(
          { websiteId: website._id, title: titleCondition },
          { 
            status: itemStatus, 
            completedBy: isChecked ? updaterName : "", 
            completedAt: isChecked ? new Date() : undefined 
          },
          { upsert: false }
        );

        // Record audit entry for accountability
        try {
          const historyLog = new ChecklistHistory({
            websiteId: website._id,
            action: "requirement_updated",
            previousState: `${title}: previous`,
            newState: `${title}: ${req.body[key]}`,
            notes: `"${title}" requirement marked as ${req.body[key]} by ${updaterName}`,
            userId: updaterId,
            username: updaterName,
            ipAddress: req.ip || req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "",
            deviceInfo: req.headers["user-agent"] || "",
          });
          await historyLog.save();
        } catch (logErr) {
          console.error("Failed to write checklist history log:", logErr.message);
        }
      }
    }

    // Recalculate readiness score
    await updateAndGetWebsiteReadinessScore(website._id);
    const updatedWebsite = await Website.findById(website._id).populate('locations').lean();

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


// Bulk update category status (e.g. mark entire category as NA) and optionally hide it
router.patch("/:id/compliance/category-status", requireAuth, async (req, res, next) => {
  try {
    const { category, status = "na", hide = false } = req.body;
    if (!category) {
      return res.status(400).json({ error: { message: "Category is required" } });
    }

    const website = await Website.findById(req.params.id);
    if (!website) {
      return res.status(404).json({ error: { message: "Website not found" } });
    }

    await ChecklistItem.updateMany(
      { websiteId: website._id, category },
      {
        $set: {
          status,
          completedBy: status === "na" || status === "completed" ? (req.user?.username || "System") : "",
          completedAt: status === "na" || status === "completed" ? new Date() : null,
        }
      }
    );

    let hiddenCategories = Array.isArray(website.hiddenCategories) ? [...website.hiddenCategories] : [];
    if (hide) {
      if (!hiddenCategories.includes(category)) {
        hiddenCategories.push(category);
      }
    } else if (status !== "na") {
      hiddenCategories = hiddenCategories.filter(c => c !== category);
    }
    website.hiddenCategories = hiddenCategories;
    await website.save();

    // Log history
    const historyLog = new ChecklistHistory({
      websiteId: website._id,
      action: "category_status_updated",
      notes: `Category "${category}" marked as ${status.toUpperCase()}${hide ? " and hidden" : ""}`,
      userId: req.user?.sub || req.user?.id || "System",
      username: req.user?.username || "System",
      ipAddress: req.ip || req.headers["x-forwarded-for"] || req.socket.remoteAddress || "",
      deviceInfo: req.headers["user-agent"] || ""
    });
    await historyLog.save();

    // If category is "Social Media", sync all social media compliance fields
    if (category === "Social Media" || category === "Social Media Compliance") {
      const socialVal = checklistStatusToCoreStatus(status);
      await Website.findByIdAndUpdate(website._id, {
        youtubeCompliance: socialVal,
        facebookCompliance: socialVal,
        xCompliance: socialVal,
        libertySocialCompliance: socialVal,
        rumbleCompliance: socialVal,
        tikTokCompliance: socialVal,
        instagramCompliance: socialVal,
        threadsCompliance: socialVal,
      });
    }

    const readinessScore = await updateAndGetWebsiteReadinessScore(website._id);
    const updatedItems = await ChecklistItem.find({ websiteId: website._id }).sort({ createdAt: 1 }).lean();
    const updatedWebsite = await Website.findById(website._id).populate('locations').lean();

    res.json({
      success: true,
      readinessScore,
      items: updatedItems,
      website: updatedWebsite,
      hiddenCategories: updatedWebsite.hiddenCategories || [],
    });
  } catch (err) {
    next(err);
  }
});

// Toggle category visibility (hide / show section for this project)
router.patch("/:id/compliance/toggle-category-visibility", requireAuth, async (req, res, next) => {
  try {
    const { category, hidden } = req.body;
    if (!category) {
      return res.status(400).json({ error: { message: "Category is required" } });
    }

    const website = await Website.findById(req.params.id);
    if (!website) {
      return res.status(404).json({ error: { message: "Website not found" } });
    }

    let hiddenCategories = Array.isArray(website.hiddenCategories) ? [...website.hiddenCategories] : [];
    if (hidden) {
      if (!hiddenCategories.includes(category)) {
        hiddenCategories.push(category);
      }
    } else {
      hiddenCategories = hiddenCategories.filter(c => c !== category);
    }

    website.hiddenCategories = hiddenCategories;
    await website.save();

    res.json({ success: true, hiddenCategories: website.hiddenCategories });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
