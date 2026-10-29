const express = require("express");
const mongoose = require("mongoose");
const { requireAuth } = require("../middleware/auth");

const Task = require("../models/Task");
const Project = require("../models/Project");
const Employee = require("../models/Employee");
const LegalCase = require("../models/LegalCase");
const CRMDeal = require("../models/CRMDeal");
const CRMContact = require("../models/CRMContact");
const Announcement = require("../models/Announcement");
const Vehicle = require("../models/Vehicle");
const Appliance = require("../models/Appliance");
const Website = require("../models/Website");

const router = express.Router();

function escapeRegExp(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

router.get("/", requireAuth, async (req, res, next) => {
  try {
    const q = String(req.query.q || req.query.search || "").trim();
    if (!q || q.length < 1) {
      return res.json({ items: [] });
    }

    const isEmployeeRole = String(req.user?.role || "").trim().toLowerCase() === "employee";
    const panelBase = String(req.query.basePath || (isEmployeeRole ? "/employee" : "/admin")).trim();

    // Generate regex pattern for case-insensitive partial substring match
    const regex = new RegExp(escapeRegExp(q), "i");

    const searchPromises = [
      // 1. Tasks
      Task.find({
        $or: [
          { title: regex },
          { description: regex },
          { assignees: { $elemMatch: { $regex: regex } } },
          { assignee: regex },
          { location: regex },
          { status: regex },
          { priority: regex }
        ]
      })
        .select("_id title description status priority assignees projectId taskNumber")
        .limit(10)
        .lean(),

      // 2. Projects
      Project.find({
        $or: [
          { name: regex },
          { description: regex },
          { teamLead: regex },
          { assignees: { $elemMatch: { $regex: regex } } }
        ]
      })
        .select("_id name description teamLead assignees")
        .limit(8)
        .lean(),

      // 3. Employees (Staff Profiles)
      Employee.find({
        $or: [
          { name: regex },
          { email: regex },
          { role: regex },
          { userRole: regex },
          { location: regex },
          { category: regex }
        ]
      })
        .select("_id name email role userRole category location")
        .limit(8)
        .lean(),

      // 4. Legal Cases
      LegalCase.find({
        $or: [
          { title: regex },
          { caseNumber: regex },
          { clientName: regex },
          { court: regex },
          { judge: regex },
          { originatingCaseNumber: regex }
        ]
      })
        .select("_id title caseNumber clientName court judge")
        .limit(8)
        .lean(),

      // 5. CRM Deals & Contacts
      CRMDeal.find({
        $or: [
          { title: regex },
          { stage: regex },
          { owner: regex }
        ]
      })
        .select("_id title stage value owner")
        .limit(6)
        .lean(),

      CRMContact.find({
        $or: [
          { name: regex },
          { email: regex },
          { company: regex },
          { phone: regex }
        ]
      })
        .select("_id name email company phone")
        .limit(6)
        .lean(),

      // 6. Announcements
      Announcement.find({
        $or: [
          { title: regex },
          { content: regex },
          { category: regex }
        ]
      })
        .select("_id title category createdAt")
        .limit(6)
        .lean(),

      // 7. Vehicles & Appliances
      Vehicle.find({
        $or: [
          { name: regex },
          { make: regex },
          { model: regex },
          { licensePlate: regex }
        ]
      })
        .select("_id name make model licensePlate")
        .limit(5)
        .lean(),

      Appliance.find({
        $or: [
          { name: regex },
          { brand: regex },
          { modelNumber: regex },
          { serialNumber: regex },
          { location: regex }
        ]
      })
        .select("_id name brand modelNumber serialNumber location")
        .limit(5)
        .lean(),

      // 8. Websites
      Website.find({
        $or: [
          { siteName: regex },
          { domainName: regex },
          { websiteType: regex },
          { status: regex }
        ]
      })
        .select("_id siteName domainName websiteType status")
        .limit(5)
        .lean(),
    ];

    const [
      tasksRes,
      projectsRes,
      employeesRes,
      legalCasesRes,
      crmDealsRes,
      crmContactsRes,
      announcementsRes,
      vehiclesRes,
      appliancesRes,
      websitesRes,
    ] = await Promise.allSettled(searchPromises);

    const results = [];

    // Format Tasks
    if (tasksRes.status === "fulfilled" && Array.isArray(tasksRes.value)) {
      tasksRes.value.forEach((t) => {
        results.push({
          id: `task-${t._id}`,
          type: "task",
          title: t.title || "Untitled Task",
          subtitle: `Task #${t.taskNumber || ""} · ${t.status || "pending"}${t.priority ? ` · ${t.priority}` : ""}`,
          url: `${panelBase}/tasks?view=${t._id}`,
          category: "Tasks",
        });
      });
    }

    // Format Projects
    if (projectsRes.status === "fulfilled" && Array.isArray(projectsRes.value)) {
      projectsRes.value.forEach((p) => {
        results.push({
          id: `project-${p._id}`,
          type: "project",
          title: p.name || "Untitled Project",
          subtitle: `Project${p.teamLead ? ` · Lead: ${p.teamLead}` : ""}`,
          url: `${panelBase}/tasks?project=${p._id}`,
          category: "Projects",
        });
      });
    }

    // Format Employees
    if (employeesRes.status === "fulfilled" && Array.isArray(employeesRes.value)) {
      employeesRes.value.forEach((e) => {
        results.push({
          id: `emp-${e._id}`,
          type: "employee",
          title: e.name || "Unnamed Staff",
          subtitle: `Staff · ${e.role || e.userRole || "Employee"}${e.email ? ` (${e.email})` : ""}`,
          url: `/admin/employees?view=${e._id}`,
          category: "Staff Directory",
        });
      });
    }

    // Format Legal Cases
    if (legalCasesRes.status === "fulfilled" && Array.isArray(legalCasesRes.value)) {
      legalCasesRes.value.forEach((c) => {
        results.push({
          id: `case-${c._id}`,
          type: "case",
          title: c.title || "Untitled Legal Case",
          subtitle: `Case #${c.caseNumber || ""} · Client: ${c.clientName || "N/A"}${c.court ? ` (${c.court})` : ""}`,
          url: `/admin/legal/cases?view=${c._id}`,
          category: "Legal Cases",
        });
      });
    }

    // Format CRM Deals
    if (crmDealsRes.status === "fulfilled" && Array.isArray(crmDealsRes.value)) {
      crmDealsRes.value.forEach((d) => {
        results.push({
          id: `crm-deal-${d._id}`,
          type: "crm",
          title: d.title || "Untitled Deal",
          subtitle: `CRM Deal · Stage: ${d.stage || "New"}${d.value ? ` · $${d.value}` : ""}`,
          url: `/admin/crm/dashboard?deal=${d._id}`,
          category: "CRM Deals",
        });
      });
    }

    // Format CRM Contacts
    if (crmContactsRes.status === "fulfilled" && Array.isArray(crmContactsRes.value)) {
      crmContactsRes.value.forEach((c) => {
        results.push({
          id: `crm-contact-${c._id}`,
          type: "crm",
          title: c.name || "Untitled Contact",
          subtitle: `CRM Contact · ${c.company || "No Company"}${c.email ? ` · ${c.email}` : ""}`,
          url: `/admin/crm/dashboard?contact=${c._id}`,
          category: "CRM Contacts",
        });
      });
    }

    // Format Announcements
    if (announcementsRes.status === "fulfilled" && Array.isArray(announcementsRes.value)) {
      announcementsRes.value.forEach((a) => {
        results.push({
          id: `announcement-${a._id}`,
          type: "announcement",
          title: a.title || "Announcement",
          subtitle: `Announcement · Category: ${a.category || "General"}`,
          url: isEmployeeRole ? `/employee/announcements` : `/admin/announcements`,
          category: "Announcements",
        });
      });
    }

    // Format Vehicles
    if (vehiclesRes.status === "fulfilled" && Array.isArray(vehiclesRes.value)) {
      vehiclesRes.value.forEach((v) => {
        results.push({
          id: `vehicle-${v._id}`,
          type: "equipment",
          title: v.name || `${v.make || ""} ${v.model || ""}`.trim() || "Vehicle",
          subtitle: `Vehicle · Plate: ${v.licensePlate || "N/A"}`,
          url: `/admin/vehicles?view=${v._id}`,
          category: "Vehicles",
        });
      });
    }

    // Format Appliances
    if (appliancesRes.status === "fulfilled" && Array.isArray(appliancesRes.value)) {
      appliancesRes.value.forEach((ap) => {
        results.push({
          id: `appliance-${ap._id}`,
          type: "equipment",
          title: ap.name || "Appliance",
          subtitle: `Appliance · Brand: ${ap.brand || "N/A"}${ap.serialNumber ? ` · S/N: ${ap.serialNumber}` : ""}`,
          url: `/admin/appliances?view=${ap._id}`,
          category: "Appliances",
        });
      });
    }

    // Format Websites
    if (websitesRes.status === "fulfilled" && Array.isArray(websitesRes.value)) {
      websitesRes.value.forEach((w) => {
        results.push({
          id: `website-${w._id}`,
          type: "website",
          title: w.siteName || w.domainName || "Website",
          subtitle: `Website · Type: ${w.websiteType || "Standard"} · Status: ${w.status || "Active"}`,
          url: `/admin/settings?tab=websites&view=${w._id}`,
          category: "Websites",
        });
      });
    }

    return res.json({ items: results });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
