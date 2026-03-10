const express = require("express");
const { z } = require("zod");

const Location = require("../models/Location");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

function withId(doc) {
  if (!doc) return doc;
  return { ...doc, id: String(doc._id) };
}

const createSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["office", "warehouse", "facility", "site"]),
  address: z.string().min(1),
  city: z.string().min(1),
  phone: z.string().min(1),
  manager: z.string().min(1),
  employeeCount: z.number().min(0),
  status: z.enum(["active", "inactive"]),
  operatingHours: z.string().min(1),
});

const adminUiSchema = z.object({
  name: z.string().min(1),
  address: z.string().min(1),
  city: z.string().min(1),
  type: z.string().optional(),
  contactPhone: z.string().optional(),
  contactName: z.string().optional(),
  tasksCount: z.number().optional(),
  status: z.enum(["active", "inactive"]).optional(),
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
        address: adminParsed.data.address,
        city: adminParsed.data.city,
        type: mappedType,
        phone: adminParsed.data.contactPhone || "",
        manager: adminParsed.data.contactName || "",
        employeeCount: Number.isFinite(adminParsed.data.tasksCount) ? adminParsed.data.tasksCount : 0,
        status: adminParsed.data.status || "active",
        operatingHours: "",
      });
      return res.status(201).json({ item: withId(created.toObject()) });
    }

    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { message: "Invalid payload" } });

    const created = await Location.create(parsed.data);
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

      if (typeof adminParsed.data.type === "string") {
        const t = String(adminParsed.data.type || "site").toLowerCase();
        patch.type = ["office", "warehouse", "facility", "site"].includes(t) ? t : "site";
      }
      if (typeof adminParsed.data.contactPhone === "string") patch.phone = adminParsed.data.contactPhone;
      if (typeof adminParsed.data.contactName === "string") patch.manager = adminParsed.data.contactName;
      if (typeof adminParsed.data.status === "string") patch.status = adminParsed.data.status;
      if (typeof adminParsed.data.tasksCount === "number") patch.employeeCount = adminParsed.data.tasksCount;

      const updated = await Location.findByIdAndUpdate(req.params.id, patch, { new: true }).lean();
      if (!updated) return res.status(404).json({ error: { message: "Location not found" } });
      return res.json({ item: withId(updated) });
    }

    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { message: "Invalid payload" } });

    const updated = await Location.findByIdAndUpdate(req.params.id, parsed.data, { new: true }).lean();
    if (!updated) return res.status(404).json({ error: { message: "Location not found" } });

    res.json({ item: withId(updated) });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const deleted = await Location.findByIdAndDelete(req.params.id).lean();
    if (!deleted) return res.status(404).json({ error: { message: "Location not found" } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;