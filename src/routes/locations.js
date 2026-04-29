const express = require("express");
const { z } = require("zod");
const axios = require("axios");

const Location = require("../models/Location");
const ActivityLog = require("../models/ActivityLog");
const { createNotification } = require("../utils/notifications");
const { requireAuth, requireRole } = require("../middleware/auth");
const { cacheWrap, cacheDel } = require("../lib/cache");

const router = express.Router();

// Helper function to log activity
async function logActivity(req, action, resourceType, resourceId, resourceName, description) {
  try {
    await ActivityLog.create({
      actorUserId: String(req.user?.sub || ""),
      actorUsername: String(req.user?.username || "unknown"),
      actorRole: String(req.user?.role || "unknown"),
      action,
      resourceType,
      resourceId: String(resourceId),
      resourceName: String(resourceName),
      description: description || `${action} on ${resourceType}`,
      ipAddress: String(req.ip || req.headers["x-forwarded-for"] || ""),
      userAgent: String(req.headers["user-agent"] || ""),
    });
  } catch (err) {
    // Silent fail - don't break the API if logging fails
    console.error("Activity logging error:", err.message);
  }
}

function withId(doc) {
  if (!doc) return doc;
  return { ...doc, id: String(doc._id) };
}

const createSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["office", "warehouse", "facility", "site"]),
  address: z.string().optional(),
  city: z.string().min(1),
  country: z.string().optional(),
  phone: z.string().min(1),
  manager: z.string().min(1),
  employeeCount: z.number().min(0),
  status: z.enum(["active", "inactive"]),
  operatingHours: z.string().min(1),
});

const adminUiSchema = z.object({
  name: z.string().min(1),
  address: z.string().optional(),
  city: z.string().min(1),
  country: z.string().optional(),
  type: z.string().optional(),
  contactPhone: z.string().optional(),
  contactName: z.string().optional(),
  tasksCount: z.number().optional(),
  employeeCount: z.number().optional(),
  status: z.enum(["active", "inactive"]).optional(),
  photoDataUrl: z.string().optional(),
  photoFileName: z.string().optional(),
  attachments: z.array(z.object({
    fileName: z.string().optional(),
    url: z.string().optional()
  })).optional(),
});

const updateSchema = createSchema.partial();

router.get("/", requireAuth, requireRole(["super-admin", "admin", "manager", "employee"]), async (_req, res, next) => {
  try {
    const result = await cacheWrap("locations:list", async () => {
      const items = await Location.find()
        .select("-photoDataUrl -photoFileName")
        .sort({ name: 1 })
        .lean();
      return { items: items.map(withId) };
    }, 60);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const adminParsed = adminUiSchema.safeParse(req.body);
    if (adminParsed.success) {
      const t = String(adminParsed.data.type || "site").toLowerCase();
      const mappedType = ["office", "warehouse", "facility", "site"].includes(t) ? t : "site";
      const created = await Location.create({
        name: adminParsed.data.name,
        address: adminParsed.data.address || "",
        city: adminParsed.data.city,
        country: adminParsed.data.country || "",
        type: mappedType,
        phone: adminParsed.data.contactPhone || "",
        manager: adminParsed.data.contactName || "",
        employeeCount: Number.isFinite(adminParsed.data.employeeCount)
          ? adminParsed.data.employeeCount
          : (Number.isFinite(adminParsed.data.tasksCount) ? adminParsed.data.tasksCount : 0),
        status: adminParsed.data.status || "active",
        operatingHours: "",
        photoDataUrl: adminParsed.data.photoDataUrl || "",
        photoFileName: adminParsed.data.photoFileName || "",
        attachments: Array.isArray(adminParsed.data.attachments) ? adminParsed.data.attachments : [],
      });

      const createdObj = withId(created.toObject());
      // Log activity with country and city info
      const locationInfo = createdObj.country 
        ? `${createdObj.name} (${createdObj.country}, ${createdObj.city})`
        : `${createdObj.name} (${createdObj.city})`;
      await logActivity(
        req,
        "LOCATION_CREATE",
        "location",
        createdObj.id,
        locationInfo,
        `Location "${createdObj.name}" in ${createdObj.country || createdObj.city} created`
      );
      
      // Create notification
      await createNotification({
        actor: req.user?.username || req.user?.name || "Admin",
        actorRole: req.user?.role || "admin",
        action: "created",
        resourceType: "location",
        resourceName: createdObj.name,
        details: createdObj.city ? `City: ${createdObj.city}` : "",
        resourceId: String(createdObj.id),
      });
      
      cacheDel("locations:list");
      return res.status(201).json({ item: withId(created.toObject()) });
    }

    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { message: "Invalid payload" } });

    const created = await Location.create(parsed.data);
    const createdObj = withId(created.toObject());
    // Log activity with city info
    await logActivity(
      req,
      "LOCATION_CREATE",
      "location",
      createdObj.id,
      `${createdObj.name} (${createdObj.city})`,
      `Location "${createdObj.name}" in ${createdObj.city} created`
    );

    // Create notification
    await createNotification({
      actor: req.user?.username || req.user?.name || "Admin",
      actorRole: req.user?.role || "admin",
      action: "created",
      resourceType: "location",
      resourceName: createdObj.name,
      details: createdObj.city ? `City: ${createdObj.city}` : "",
      resourceId: String(createdObj.id),
    });
    cacheDel("locations:list");
    res.status(201).json({ item: withId(created.toObject()) });
  } catch (err) {
    next(err);
  }
});

router.get("/:id/photo", requireAuth, async (req, res, next) => {
  try {
    const loc = await Location.findById(req.params.id).select("photoDataUrl photoFileName attachments").lean();
    if (!loc) return res.status(404).json({ error: { message: "Location not found" } });
    res.json({ 
      photoDataUrl: loc.photoDataUrl || "", 
      photoFileName: loc.photoFileName || "",
      attachments: loc.attachments || []
    });
  } catch (err) {
    next(err);
  }
});

router.get("/:id/render-photo", async (req, res) => {
  try {
    const loc = await Location.findById(req.params.id).select("photoDataUrl").lean();
    if (!loc || !loc.photoDataUrl) {
      return res.status(404).send("Not found");
    }

    let contentType = "image/png";
    let base64Data = "";

    if (loc.photoDataUrl.startsWith("data:")) {
      const parts = loc.photoDataUrl.split(";base64,");
      if (parts.length === 2) {
        contentType = parts[0].replace("data:", "");
        base64Data = parts[1];
      } else {
         return res.status(400).send("Invalid data URI format");
      }
    } else {
      // Fallback if it's just raw base64 (not recommended but seen in some legacy data)
      base64Data = loc.photoDataUrl;
    }

    const buffer = Buffer.from(base64Data, 'base64');

    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": buffer.length,
      "Cache-Control": "no-cache"
    });
    res.end(buffer);
  } catch (err) {
    res.status(500).send("Error rendering image");
  }
});

router.put("/:id", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const adminParsed = adminUiSchema.partial().safeParse(req.body);
    if (adminParsed.success) {
      const patch = {};
      if (typeof adminParsed.data.name === "string") patch.name = adminParsed.data.name;
      if (typeof adminParsed.data.address === "string") patch.address = adminParsed.data.address;
      if (typeof adminParsed.data.city === "string") patch.city = adminParsed.data.city;
      if (typeof adminParsed.data.country === "string") patch.country = adminParsed.data.country;

      if (typeof adminParsed.data.type === "string") {
        const t = String(adminParsed.data.type || "site").toLowerCase();
        patch.type = ["office", "warehouse", "facility", "site"].includes(t) ? t : "site";
      }
      if (typeof adminParsed.data.contactPhone === "string") patch.phone = adminParsed.data.contactPhone;
      if (typeof adminParsed.data.contactName === "string") patch.manager = adminParsed.data.contactName;
      if (typeof adminParsed.data.status === "string") patch.status = adminParsed.data.status;
      if (typeof adminParsed.data.tasksCount === "number") patch.employeeCount = adminParsed.data.tasksCount;
      if (typeof adminParsed.data.photoDataUrl === "string") patch.photoDataUrl = adminParsed.data.photoDataUrl;
      if (typeof adminParsed.data.photoFileName === "string") patch.photoFileName = adminParsed.data.photoFileName;
      if (Array.isArray(adminParsed.data.attachments)) patch.attachments = adminParsed.data.attachments;

      const updated = await Location.findByIdAndUpdate(req.params.id, patch, { new: true }).lean();
      if (!updated) return res.status(404).json({ error: { message: "Location not found" } });
      const updatedObj = withId(updated);
      // Log activity with country and city info
      const locationInfo = updatedObj.country 
        ? `${updatedObj.name} (${updatedObj.country}, ${updatedObj.city})`
        : `${updatedObj.name} (${updatedObj.city})`;
      await logActivity(
        req,
        "LOCATION_UPDATE",
        "location",
        updatedObj.id,
        locationInfo,
        `Location "${updatedObj.name}" in ${updatedObj.country || updatedObj.city} updated`
      );
      
      // Create notification
      await createNotification({
        actor: req.user?.username || req.user?.name || "Admin",
        actorRole: req.user?.role || "admin",
        action: "updated",
        resourceType: "location",
        resourceName: updatedObj.name,
        details: patch.status ? `Status: ${patch.status}` : "",
        resourceId: String(updatedObj.id),
      });
      
      cacheDel("locations:list");
      return res.json({ item: updatedObj });
    }

    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { message: "Invalid payload" } });

    const updated = await Location.findByIdAndUpdate(req.params.id, parsed.data, { new: true }).lean();
    if (!updated) return res.status(404).json({ error: { message: "Location not found" } });
    const updatedObj = withId(updated);
    // Log activity with country and city info
    const locationInfo = updatedObj.country 
      ? `${updatedObj.name} (${updatedObj.country}, ${updatedObj.city})`
      : `${updatedObj.name} (${updatedObj.city})`;
    await logActivity(
      req,
      "LOCATION_UPDATE",
      "location",
      updatedObj.id,
      locationInfo,
      `Location "${updatedObj.name}" in ${updatedObj.country || updatedObj.city} updated`
    );
    
    // Create notification
    await createNotification({
      actor: req.user?.username || req.user?.name || "Admin",
      actorRole: req.user?.role || "admin",
      action: "updated",
      resourceType: "location",
      resourceName: updatedObj.name,
      resourceId: String(updatedObj.id),
    });
    cacheDel("locations:list");
    res.json({ item: updatedObj });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const deleted = await Location.findByIdAndDelete(req.params.id).lean();
    if (!deleted) return res.status(404).json({ error: { message: "Location not found" } });
    const deletedObj = withId(deleted);
    // Log activity with country and city info
    const locationInfo = deletedObj.country 
      ? `${deletedObj.name} (${deletedObj.country}, ${deletedObj.city})`
      : `${deletedObj.name} (${deletedObj.city})`;
    await logActivity(
      req,
      "LOCATION_DELETE",
      "location",
      deletedObj.id,
      locationInfo,
      `Location "${deletedObj.name}" in ${deletedObj.country || deletedObj.city} deleted`
    );
    
    // Create notification
    await createNotification({
      actor: req.user?.username || req.user?.name || "Admin",
      actorRole: req.user?.role || "admin",
      action: "deleted",
      resourceType: "location",
      resourceName: deletedObj.name,
      resourceId: String(deletedObj.id),
    });
    cacheDel("locations:list");
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

router.get("/countries", requireAuth, async (_req, res, next) => {
  try {
    // Get unique countries from existing locations + common countries
    const existingCountries = await Location.distinct("country").lean();
    const commonCountries = [
      "USA", "Canada", "UK", "Germany", "France", "Italy", "Spain", "Australia",
      "Japan", "China", "India", "Brazil", "Mexico", "UAE", "Saudi Arabia",
      "Pakistan", "Turkey", "Russia", "South Korea", "Netherlands", "Sweden",
      "Switzerland", "Singapore", "Malaysia", "Thailand", "Indonesia", "Philippines",
      "Vietnam", "Bangladesh", "Egypt", "Nigeria", "South Africa", "Kenya",
      "Argentina", "Chile", "Colombia", "Peru", "New Zealand", "Ireland",
      "Belgium", "Austria", "Poland", "Czech Republic", "Portugal", "Greece"
    ];
    const allCountries = [...new Set([...existingCountries.filter(Boolean), ...commonCountries])].sort();
    res.json({ countries: allCountries });
  } catch (err) {
    next(err);
  }
});

router.get("/cities", requireAuth, async (req, res, next) => {
  try {
    const { country } = req.query;
    if (!country) {
      return res.json({ cities: [] });
    }

    // Fetch cities from DB and external API in parallel
    const [existingCities, apiCities] = await Promise.all([
      Location.distinct("city", { country }).lean(),
      axios
        .post(
          "https://countriesnow.space/api/v0.1/countries/cities",
          { country },
          { timeout: 5000 }
        )
        .then((r) => (Array.isArray(r.data?.data) ? r.data.data : []))
        .catch(() => []), // if API is down, fall back silently
    ]);

    const allCities = [...new Set([...existingCities.filter(Boolean), ...apiCities])].sort();
    res.json({ cities: allCities });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
