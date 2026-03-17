const express = require("express");
const { z } = require("zod");

const Location = require("../models/Location");
const ActivityLog = require("../models/ActivityLog");
const { createNotification } = require("../utils/notifications");
const { requireAuth } = require("../middleware/auth");

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
  status: z.enum(["active", "inactive"]).optional(),
  photoDataUrl: z.string().optional(),
  photoFileName: z.string().optional(),
});

const updateSchema = createSchema.partial();

router.get("/", requireAuth, async (_req, res, next) => {
  try {
    const items = await Location.find().sort({ createdAt: -1 }).lean();
    res.json({ items: items.map(withId) });
  } catch (err) {
    next(err);
  }
});

router.post("/", requireAuth, async (req, res, next) => {
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
        employeeCount: Number.isFinite(adminParsed.data.tasksCount) ? adminParsed.data.tasksCount : 0,
        status: adminParsed.data.status || "active",
        operatingHours: "",
        photoDataUrl: adminParsed.data.photoDataUrl || "",
        photoFileName: adminParsed.data.photoFileName || "",
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
      });
      
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
    });
    
    res.status(201).json({ item: withId(created.toObject()) });
  } catch (err) {
    next(err);
  }
});

router.put("/:id", requireAuth, async (req, res, next) => {
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
      });
      
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
    });
    
    res.json({ item: updatedObj });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", requireAuth, async (req, res, next) => {
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
    });
    
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

    // Common cities by country
    const citiesByCountry = {
      "USA": ["New York", "Los Angeles", "Chicago", "Houston", "Phoenix", "Philadelphia", "San Antonio", "San Diego", "Dallas", "San Jose", "Austin", "Jacksonville", "Fort Worth", "Columbus", "Charlotte", "San Francisco", "Indianapolis", "Seattle", "Denver", "Washington", "Boston", "El Paso", "Nashville", "Detroit", "Oklahoma City", "Portland", "Las Vegas", "Louisville", "Baltimore", "Milwaukee", "Albuquerque", "Tucson", "Fresno", "Mesa", "Sacramento", "Atlanta", "Kansas City", "Colorado Springs", "Omaha", "Raleigh", "Miami", "Long Beach", "Virginia Beach", "Oakland", "Minneapolis", "Tulsa", "Tampa", "Arlington", "New Orleans"],
      "Canada": ["Toronto", "Montreal", "Vancouver", "Calgary", "Edmonton", "Ottawa", "Winnipeg", "Quebec City", "Hamilton", "Kitchener", "London", "Victoria", "Halifax", "Oshawa", "Windsor", "Saskatoon", "St. Catharines", "Regina", "Barrie", "St. John's", "Kelowna", "Sherbrooke", "Guelph", "Abbotsford", "Kingston", "Kanata", "Milton", "Moncton", "Whitehorse", "Red Deer"],
      "UK": ["London", "Birmingham", "Manchester", "Glasgow", "Liverpool", "Leeds", "Sheffield", "Edinburgh", "Bristol", "Cardiff", "Belfast", "Leicester", "Coventry", "Bradford", "Nottingham", "Plymouth", "Stoke-on-Trent", "Wolverhampton", "Derby", "Swansea", "Southampton", "Aberdeen", "Portsmouth", "York", "Dundee", "Oxford", "Cambridge"],
      "Germany": ["Berlin", "Hamburg", "Munich", "Cologne", "Frankfurt", "Stuttgart", "Dusseldorf", "Dortmund", "Essen", "Leipzig", "Bremen", "Dresden", "Hanover", "Nuremberg", "Duisburg", "Bochum", "Wuppertal", "Bielefeld", "Bonn", "Munster", "Karlsruhe", "Mannheim", "Augsburg", "Wiesbaden", "Gelsenkirchen", "Mönchengladbach", "Braunschweig", "Chemnitz", "Kiel", "Aachen"],
      "France": ["Paris", "Marseille", "Lyon", "Toulouse", "Nice", "Nantes", "Strasbourg", "Montpellier", "Bordeaux", "Lille", "Rennes", "Reims", "Le Havre", "Saint-Etienne", "Toulon", "Grenoble", "Dijon", "Angers", "Nîmes", "Villeurbanne", "Saint-Denis", "Le Mans", "Aix-en-Provence", "Brest", "Limoges", "Tours", "Amiens", "Perpignan", "Metz", "Besançon"],
      "Australia": ["Sydney", "Melbourne", "Brisbane", "Perth", "Adelaide", "Gold Coast", "Newcastle", "Canberra", "Sunshine Coast", "Wollongong", "Hobart", "Geelong", "Townsville", "Cairns", "Toowoomba", "Darwin", "Ballarat", "Bendigo", "Albury", "Launceston", "Mackay", "Rockhampton", "Bunbury", "Bundaberg", "Coffs Harbour", "Wagga Wagga", "Hervey Bay", "Mildura", "Shepparton", "Port Macquarie"],
      "Pakistan": ["Karachi", "Lahore", "Islamabad", "Faisalabad", "Rawalpindi", "Gujranwala", "Multan", "Peshawar", "Quetta", "Sialkot", "Bahawalpur", "Sargodha", "Abbottabad", "Sheikhupura", "Jhelum", "Gujrat", "Mardan", "Kasur", "Dera Ghazi Khan", "Sahiwal", "Okara", "Wah", "Rahim Yar Khan", "Chiniot", "Kamoke", "Mandi Bahauddin", "Jaranwala", "Chishtian", "Attock", "Kotli"],
      "India": ["Mumbai", "Delhi", "Bangalore", "Hyderabad", "Ahmedabad", "Chennai", "Kolkata", "Surat", "Pune", "Jaipur", "Lucknow", "Kanpur", "Nagpur", "Indore", "Thane", "Bhopal", "Visakhapatnam", "Pimpri-Chinchwad", "Patna", "Vadodara", "Ghaziabad", "Ludhiana", "Agra", "Nashik", "Faridabad", "Meerut", "Rajkot", "Kalyan-Dombivli", "Vasai-Virar", "Varanasi"],
      "UAE": ["Dubai", "Abu Dhabi", "Sharjah", "Ajman", "Ras Al Khaimah", "Fujairah", "Umm Al Quwain", "Al Ain"],
      "Saudi Arabia": ["Riyadh", "Jeddah", "Mecca", "Medina", "Dammam", "Taif", "Tabuk", "Buraidah", "Khamis Mushait", "Abha", "Hail", "Najran", "Jazan", "Al Bahah", "Skaka", "Arar", "Hafar Al-Batin", "Al-Kharj", "Qatif", "Khobar"],
    };

    // Get existing cities from database for this country
    const existingCities = await Location.distinct("city", { country }).lean();
    
    // Combine with common cities
    const commonCities = citiesByCountry[country] || [];
    const allCities = [...new Set([...existingCities.filter(Boolean), ...commonCities])].sort();
    
    res.json({ cities: allCities });
  } catch (err) {
    next(err);
  }
});

module.exports = router;