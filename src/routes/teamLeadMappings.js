const express = require("express");
const { z } = require("zod");

const TeamLeadMapping = require("../models/TeamLeadMapping");
const User = require("../models/User");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

function withId(doc) {
  if (!doc) return doc;
  return { ...doc, id: String(doc._id) };
}

const upsertSchema = z.object({
  teamLead: z.string().min(1),
  user: z.string().min(1),
  allowOverrideAdminAssignments: z.boolean().optional(),
});

// Admin-only: list mappings
router.get("/", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const teamLead = String(req.query.teamLead || "").trim();
    const filter = teamLead ? { teamLead } : {};
    const items = await TeamLeadMapping.find(filter).sort({ createdAt: -1 }).lean();
    res.json({ items: items.map(withId) });
  } catch (err) {
    next(err);
  }
});

// Admin-only: create/update mapping
router.post("/", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const parsed = upsertSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload", details: parsed.error.errors } });
    }

    const { teamLead, user, allowOverrideAdminAssignments } = parsed.data;

    const doc = await TeamLeadMapping.findOneAndUpdate(
      { teamLead, user },
      {
        $set: {
          teamLead,
          user,
          ...(allowOverrideAdminAssignments !== undefined ? { allowOverrideAdminAssignments } : {}),
        },
      },
      { new: true, upsert: true, runValidators: true }
    ).lean();

    res.status(201).json({ item: withId(doc) });
  } catch (err) {
    next(err);
  }
});

// Admin-only: delete mapping
router.delete("/", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const teamLead = String(req.query.teamLead || "").trim();
    const user = String(req.query.user || "").trim();
    if (!teamLead || !user) {
      return res.status(400).json({ error: { message: "teamLead and user query params are required" } });
    }

    await TeamLeadMapping.deleteOne({ teamLead, user });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// TeamLead/Admin: get my mapped users
router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const role = String(req.user?.role || "").trim().toLowerCase();
    if (!role || (role !== "team-lead" && role !== "admin" && role !== "super-admin" && role !== "employee")) {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }

    const userId = String(req.user?.sub || "").trim();
    if (!userId) return res.status(400).json({ error: { message: "Cannot identify user" } });

    const user = await User.findById(userId).lean();
    if (!user) return res.status(404).json({ error: { message: "User not found" } });

    const identifiers = [user.email, user.username, user.name].map((v) => String(v || "").trim()).filter(Boolean);
    if (identifiers.length === 0) return res.status(400).json({ error: { message: "Cannot identify user" } });

    // Employee view: find their team lead, then return full team (lead + teammates)
    if (role === "employee") {
      const myMapping = await TeamLeadMapping.findOne({ user: { $in: identifiers } }).lean();
      if (!myMapping) return res.json({ items: [] });
      const items = await TeamLeadMapping.find({ teamLead: myMapping.teamLead }).sort({ createdAt: -1 }).lean();
      return res.json({ items: items.map(withId) });
    }

    // Team lead/admin view: return mappings for that team lead identifier (prefer email)
    const teamLead = identifiers[0];
    const items = await TeamLeadMapping.find({ teamLead }).sort({ createdAt: -1 }).lean();
    return res.json({ items: items.map(withId) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
