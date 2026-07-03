const express = require("express");
const { z } = require("zod");

const TimeEntry = require("../models/TimeEntry");
const Employee = require("../models/Employee");
const TimeEditAuditLog = require("../models/TimeEditAuditLog");
const { createNotification } = require("../utils/notifications");
const { requireAuth, requireRole } = require("../middleware/auth");
const {
  evaluateMealBreakCompliance,
  evaluateOvertimeCompliance,
  startOfWeekISO,
  endOfWeekISO,
} = require("../lib/complianceEngine");
const { parsePagination, paginatedResponse } = require("../lib/pagination");
const { cacheWrap, cacheDel } = require("../lib/cache");

const router = express.Router();

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\$&");
}

const createSchema = z.object({
  employee: z.string().min(1),
  avatar: z.string().optional().default(""),
  userId: z.string().optional().default(""),
  stateCode: z.string().optional().default(""),
  hourlyRate: z.number().optional().default(0),
  date: z.union([z.string(), z.date()]),
  clockIn: z.string().optional().default(""),
  clockOut: z.string().optional().default(""),
  breakTime: z.string().optional().default(""),
  clockInAt: z.union([z.string(), z.date()]).optional(),
  clockOutAt: z.union([z.string(), z.date()]).optional(),
  breaks: z
    .array(
      z.object({
        type: z.enum(["meal", "rest"]).optional().default("meal"),
        startAt: z.union([z.string(), z.date()]).optional(),
        endAt: z.union([z.string(), z.date()]).optional(),
      })
    )
    .optional()
    .default([]),
  totalHours: z.number().optional().default(0),
  status: z.enum(["complete", "incomplete", "overtime"]).optional(),
  location: z.string().optional().default(""),
});

const adminUiSchema = z.object({
  employee: z.string().min(1),
  initials: z.string().optional(),
  location: z.string().min(1),
  date: z.string().min(1),
  clockIn: z.string().min(1),
  clockOut: z.string().nullable().optional(),
  clockInAt: z.string().optional(),
  clockOutAt: z.string().optional(),
  status: z.string().optional(),
});

const updateSchema = createSchema.partial();

function withId(doc) {
  if (!doc) return doc;
  return { ...doc, id: String(doc._id) };
}

function userDisplayName(userDoc) {
  const name = String(userDoc?.name || "").trim();
  if (name) return name;
  const username = String(userDoc?.username || "").trim();
  if (username) return username;
  return "";
}

function employeeDisplayName(empDoc) {
  const name = String(empDoc?.name || "").trim();
  if (name) return name;
  return "";
}

function toDateSafe(v) {
  if (!v) return undefined;
  const d = v instanceof Date ? v : new Date(v);
  if (!Number.isFinite(d.getTime())) return undefined;
  return d;
}

function parseHHMM(v) {
  const s = String(v || "").trim();
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(s);
  if (!m) return null;
  return { h: Number(m[1]), min: Number(m[2]) };
}

function combineDateAndTime(date, hhmm) {
  const t = parseHHMM(hhmm);
  if (!t) return undefined;
  const d = new Date(date);
  if (!Number.isFinite(d.getTime())) return undefined;
  d.setHours(t.h, t.min, 0, 0);
  return d;
}

function calcTotalHours(entry) {
  const start = entry.clockInAt || combineDateAndTime(entry.date, entry.clockIn);
  const end = entry.clockOutAt || combineDateAndTime(entry.date, entry.clockOut);
  if (!start || !end) return 0;
  const diffMs = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(diffMs) || diffMs <= 0) return 0;
  const totalMinutes = diffMs / 60000;

  const breaks = Array.isArray(entry.breaks) ? entry.breaks : [];
  const breakMinutes = breaks
    .filter((b) => b?.startAt && b?.endAt)
    .reduce((acc, b) => acc + Math.max(0, (new Date(b.endAt).getTime() - new Date(b.startAt).getTime()) / 60000), 0);

  const paidMinutes = Math.max(0, totalMinutes - breakMinutes);
  return Number((paidMinutes / 60).toFixed(2));
}

function getClientIp(req) {
  const hdr = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return hdr || String(req.socket?.remoteAddress || "");
}

async function writeAuditLogs({ timeEntryId, before, after, editedByUserId, ipAddress }) {
  const fields = [
    "clockIn",
    "clockOut",
    "clockInAt",
    "clockOutAt",
    "breakTime",
    "breaks",
    "totalHours",
    "status",
    "location",
  ];

  const logs = [];
  for (const f of fields) {
    const a = before?.[f];
    const b = after?.[f];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    logs.push({
      timeEntryId,
      field: f,
      originalValue: a,
      modifiedValue: b,
      editedByUserId,
      ipAddress,
    });
  }

  if (logs.length) {
    await TimeEditAuditLog.insertMany(logs);
  }
}

router.get("/", requireAuth, requireRole(["employee", "manager", "admin", "super-admin"]), async (req, res, next) => {
  try {
    const employeeQuery = String(req.query?.employee || "").trim();
    const { page, limit, skip } = parsePagination(req.query);
   /* const filter = {};
    if (employeeQuery) {
      filter.employee = new RegExp(`^${escapeRegex(employeeQuery)}$`, "i");
    }*/
   const filter = {};

const userRole = String(req.user?.role || "").toLowerCase();
const userId = String(req.user?.sub || "").trim();

if (userRole === "employee") {
  // Employee can only access own entries
  filter.userId = userId;
} else {
  // Admin/manager can filter any employee
  if (employeeQuery) {
    filter.employee = new RegExp(
      `^${escapeRegex(employeeQuery)}$`,
      "i"
    );
  }
}

    const cacheKey = `time-entries:list:${employeeQuery || 'all'}:p${page}:l${limit}:${req.user?.sub || ''}`;
    
    const result = await cacheWrap(cacheKey, async () => {
      const [items, total] = await Promise.all([
        TimeEntry.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        TimeEntry.countDocuments(filter),
      ]);

      const userIds = Array.from(
        new Set(
          items
            .map((e) => String(e.userId || "").trim())
            .filter(Boolean)
        )
      );

      const emps = userIds.length
        ? await Employee.find({ _id: { $in: userIds } }, { name: 1, email: 1 }).lean()
        : [];

      const empById = new Map(emps.map((e) => [String(e._id), e]));

      // Resolve avatars from Settings. Entries carry userId (Employee._id); legacy
      // entries only have the employee name, so map those names to an Employee._id too.
      const namesWithoutId = Array.from(new Set(
        items
          .filter((e) => !String(e.userId || "").trim())
          .map((e) => String(e.employee || "").trim())
          .filter(Boolean)
      ));
      const empsByName = namesWithoutId.length
        ? await Employee.find({ name: { $in: namesWithoutId } }, { name: 1 }).lean()
        : [];
      const idByName = new Map(empsByName.map((e) => [e.name, String(e._id)]));

      const { getAuthorProfileMap } = require("../utils/authorProfile");
      const profileMap = await getAuthorProfileMap([
        ...userIds,
        ...empsByName.map((e) => String(e._id)),
      ]);

      const enriched = items.map((e) => {
        const uid = String(e.userId || "").trim();
        const emp = uid ? empById.get(uid) : null;
        const resolved = employeeDisplayName(emp) || String(e.employee || "").trim();
        const avatarId = uid || idByName.get(String(e.employee || "").trim()) || "";
        const avatar = (avatarId && profileMap[avatarId]?.avatar) || "";
        return withId({ ...e, employee: resolved || e.employee, avatar });
      });

      // Compliance evaluation (partial - don't block list query if it fails)
      try {
        const now = new Date();
        const active = items.filter((e) => (e.clockInAt || e.clockIn) && !(e.clockOutAt || e.clockOut));
        for (const e of active) {
          evaluateMealBreakCompliance({ timeEntry: e, now }).catch(() => {});
        }
      } catch (e) {}

      return paginatedResponse(enriched, total, page, limit);
    }, 15);

    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/", requireAuth, async (req, res, next) => {
  try {
    const adminParsed = adminUiSchema.safeParse(req.body);
    if (adminParsed.success) {
      const created = await TimeEntry.create({
        employee: adminParsed.data.employee,
        avatar: "",
        date: new Date(adminParsed.data.date),
        clockIn: adminParsed.data.clockIn,
        clockOut: adminParsed.data.clockOut || "",
        clockInAt: adminParsed.data.clockInAt ? toDateSafe(adminParsed.data.clockInAt) : undefined,
        clockOutAt: adminParsed.data.clockOutAt ? toDateSafe(adminParsed.data.clockOutAt) : undefined,
        breakTime: "",
        totalHours: 0,
        status: adminParsed.data.clockOut ? "complete" : "incomplete",
        location: adminParsed.data.location,
      });
      
      // Create notification
      await createNotification({
        actor: req.user?.name || req.user?.username || "Admin",
        actorRole: req.user?.role || "admin",
        action: "created",
        resourceType: "time entry",
        resourceName: adminParsed.data.employee,
        details: `Date: ${adminParsed.data.date}`,
        resourceId: String(created._id),
      });
      
      return res.status(201).json({ item: withId(created.toObject()) });
    }

    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload" } });
    }

    const created = await TimeEntry.create({
      ...parsed.data,
      userId: parsed.data.userId || String(req.user?.sub || ""),
      date: new Date(parsed.data.date),
      clockInAt: toDateSafe(parsed.data.clockInAt) || undefined,
      clockOutAt: toDateSafe(parsed.data.clockOutAt) || undefined,
      breaks: (parsed.data.breaks || []).map((b) => ({
        type: b.type || "meal",
        startAt: toDateSafe(b.startAt) || undefined,
        endAt: toDateSafe(b.endAt) || undefined,
      })),
    });

    const obj = created.toObject();
    
    // Fire-and-forget side effects
    Promise.allSettled([
      createNotification({
        actor: req.user?.name || req.user?.username || "Admin",
        actorRole: req.user?.role || "admin",
        action: "created",
        resourceType: "time entry",
        resourceName: parsed.data.employee,
        details: `Date: ${parsed.data.date}`,
        resourceId: String(created._id),
      }),
      cacheDel("time-entries:list:*")
    ]).catch(() => {});
    
    return res.status(201).json({ item: withId(obj) });
  } catch (err) {
    return next(err);
  }
});

router.post("/clock-in", requireAuth, async (req, res, next) => {
  try {
    const schema = z.object({
      employee: z.string().min(1),
      location: z.string().optional().default(""),
      stateCode: z.string().optional().default(""),
      hourlyRate: z.number().optional().default(0),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { message: "Invalid payload" } });

    let employeeName = String(parsed.data.employee || "").trim();
    try {
      const userId = String(req.user?.sub || "").trim();
      if (userId) {
        const emp = await Employee.findById(userId, { name: 1, email: 1 }).lean();
        const resolved = employeeDisplayName(emp);
        if (resolved) employeeName = resolved;
      }
    } catch {
      // ignore name resolution errors
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existing = await TimeEntry.findOne({
      employee: employeeName,
      date: { $gte: today, $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000) },
      clockOutAt: { $exists: false },
    }).lean();

    if (existing) {
      return res.status(400).json({ error: { message: "Already clocked in" } });
    }

    const created = await TimeEntry.create({
      userId: String(req.user?.sub || ""),
      employee: employeeName,
      avatar: "",
      stateCode: parsed.data.stateCode || "",
      hourlyRate: Number(parsed.data.hourlyRate) || 0,
      date: new Date(),
      clockInAt: new Date(),
      clockIn: "",
      clockOut: "",
      breaks: [],
      breakTime: "",
      totalHours: 0,
      status: "incomplete",
      location: parsed.data.location || "",
    });

    cacheDel("time-entries:list:*").catch(() => {});

    return res.status(201).json({ item: withId(created.toObject()) });
  } catch (err) {
    return next(err);
  }
});

router.post("/:id/breaks/start", requireAuth, async (req, res, next) => {
  try {
    const schema = z.object({ type: z.enum(["meal", "rest"]).optional().default("meal") });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: { message: "Invalid payload" } });

    const entry = await TimeEntry.findById(req.params.id);
    if (!entry) return res.status(404).json({ error: { message: "Time entry not found" } });

    if (entry.clockOutAt) {
      return res.status(400).json({ error: { message: "Cannot start break after clock-out" } });
    }

    entry.breaks = Array.isArray(entry.breaks) ? entry.breaks : [];
    entry.breaks.push({ type: parsed.data.type, startAt: new Date(), endAt: undefined });
    await entry.save();

    await evaluateMealBreakCompliance({ timeEntry: entry.toObject(), now: new Date() });

    return res.json({ item: withId(entry.toObject()) });
  } catch (err) {
    return next(err);
  }
});

router.post("/:id/breaks/end", requireAuth, async (req, res, next) => {
  try {
    const schema = z.object({ type: z.enum(["meal", "rest"]).optional().default("meal") });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: { message: "Invalid payload" } });

    const entry = await TimeEntry.findById(req.params.id);
    if (!entry) return res.status(404).json({ error: { message: "Time entry not found" } });

    const breaks = Array.isArray(entry.breaks) ? entry.breaks : [];
    for (let i = breaks.length - 1; i >= 0; i--) {
      const b = breaks[i];
      if (String(b.type || "meal") !== parsed.data.type) continue;
      if (b.startAt && !b.endAt) {
        b.endAt = new Date();
        entry.breaks = breaks;
        break;
      }
    }

    await entry.save();

    await evaluateMealBreakCompliance({ timeEntry: entry.toObject(), now: new Date() });

    return res.json({ item: withId(entry.toObject()) });
  } catch (err) {
    return next(err);
  }
});

router.post("/:id/clock-out", requireAuth, async (req, res, next) => {
  try {
    const entry = await TimeEntry.findById(req.params.id);
    if (!entry) return res.status(404).json({ error: { message: "Time entry not found" } });

    if (!entry.clockInAt && !entry.clockIn) {
      return res.status(400).json({ error: { message: "Cannot clock out without clock in" } });
    }

    if (entry.clockOutAt) {
      return res.status(400).json({ error: { message: "Already clocked out" } });
    }

    const now = new Date();
    entry.clockOutAt = now;
    entry.clockOut = now.toTimeString().slice(0, 5);
    entry.status = "complete";
    entry.totalHours = calcTotalHours(entry);

    // Accept optional EOD/scrum data from body
    const body = req.body || {};
    let eodData = null;
    if (typeof body.eodReport === "object" && body.eodReport !== null) {
      entry.scrum = JSON.stringify(body.eodReport);
      eodData = body.eodReport;
    } else if (typeof body.scrum === "string" && body.scrum.trim()) {
      entry.scrum = body.scrum.trim();
      try {
        eodData = JSON.parse(body.scrum);
      } catch {
        eodData = { tasksCompleted: body.scrum.trim(), issuesBlockers: "", notes: "" };
      }
    }

    if (eodData) {
      try {
        const EODReport = require("../models/EODReport");
        const emp = await Employee.findOne({ $or: [{ _id: entry.userId }, { name: entry.employee }] }).lean();
        if (emp) {
          const start = new Date(entry.date);
          start.setHours(0, 0, 0, 0);
          const end = new Date(entry.date);
          end.setHours(23, 59, 59, 999);

          const existingReport = await EODReport.findOne({
            userId: String(emp._id),
            date: { $gte: start, $lte: end },
          });

          if (existingReport) {
            existingReport.rawInput = JSON.stringify(eodData);
            existingReport.status = "submitted";
            existingReport.timeEntryId = entry._id;
            await existingReport.save();
          } else {
            await EODReport.create({
              userId: String(emp._id),
              employeeId: String(emp._id),
              employeeName: emp.name,
              date: entry.date || new Date(),
              rawInput: JSON.stringify(eodData),
              inputType: "text",
              status: "submitted",
              timeEntryId: entry._id,
            });
          }
          const { cacheDel } = require("../lib/cache");
          cacheDel("eod-reports:*").catch(() => {});
        }
      } catch (err) {
        console.error("Failed to automatically sync EOD report on clock-out:", err);
      }
    }

    const check = await evaluateMealBreakCompliance({ timeEntry: entry.toObject(), now: new Date() });
    if (check?.hardStop) {
      return res.status(400).json({ error: { message: "Meal break required before clock-out" } });
    }

    await entry.save();

    const refDate = entry.date || new Date();
    const weekStart = startOfWeekISO(refDate);
    const weekEnd = endOfWeekISO(refDate);
    const weekEntries = await TimeEntry.find({
      employee: entry.employee,
      date: { $gte: new Date(`${weekStart}T00:00:00.000Z`), $lte: new Date(`${weekEnd}T23:59:59.999Z`) },
    }).lean();

    let hourlyRate = Number(entry.hourlyRate) || 0;
    if (!hourlyRate) {
      const emp = await Employee.findOne({ name: entry.employee }).lean();
      const rate = Number(String(emp?.payRate || "").replace(/[^0-9.]/g, ""));
      if (Number.isFinite(rate)) hourlyRate = rate;
    }

    await evaluateOvertimeCompliance({
      employee: entry.employee,
      userId: entry.userId,
      timeEntries: weekEntries,
      hourlyRate,
      stateCode: entry.stateCode,
      refDate,
    });

    return res.json({ item: withId(entry.toObject()) });
  } catch (err) {
    return next(err);
  }
});

router.put("/:id", requireAuth, async (req, res, next) => {
  try {
    const adminParsed = adminUiSchema.partial().safeParse(req.body);
    if (adminParsed.success) {
      const patch = {};
      if (typeof adminParsed.data.employee === "string") patch.employee = adminParsed.data.employee;
      if (typeof adminParsed.data.location === "string") patch.location = adminParsed.data.location;
      if (typeof adminParsed.data.clockIn === "string") patch.clockIn = adminParsed.data.clockIn;
      if (typeof adminParsed.data.clockOut === "string" || adminParsed.data.clockOut === null) {
        patch.clockOut = adminParsed.data.clockOut || "";
      }
      if (typeof adminParsed.data.date === "string") patch.date = new Date(adminParsed.data.date);

      if (patch.clockOut) patch.status = "complete";
      else patch.status = "incomplete";

      const updated = await TimeEntry.findByIdAndUpdate(req.params.id, patch, { new: true }).lean();
      if (!updated) return res.status(404).json({ error: { message: "Time entry not found" } });
      
      // Create notification
      await createNotification({
        actor: req.user?.name || req.user?.username || "Admin",
        actorRole: req.user?.role || "admin",
        action: "updated",
        resourceType: "time entry",
        resourceName: updated.employee,
        details: patch.status ? `Status: ${patch.status}` : "",
        resourceId: String(req.params.id),
      });
      
      return res.json({ item: withId(updated) });
    }

    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload" } });
    }

    const before = await TimeEntry.findById(req.params.id).lean();
    if (!before) {
      return res.status(404).json({ error: { message: "Time entry not found" } });
    }

    const patch = { ...parsed.data };
    if (patch.date) patch.date = new Date(patch.date);
    if (patch.clockInAt) patch.clockInAt = toDateSafe(patch.clockInAt);
    if (patch.clockOutAt) patch.clockOutAt = toDateSafe(patch.clockOutAt);
    if (patch.breaks) {
      patch.breaks = (patch.breaks || []).map((b) => ({
        type: b.type || "meal",
        startAt: toDateSafe(b.startAt),
        endAt: toDateSafe(b.endAt),
      }));
    }

    const merged = { ...before, ...patch };
    if (merged.clockOutAt || merged.clockOut) {
      const tmp = { ...merged };
      const totalHours = calcTotalHours(tmp);
      patch.totalHours = totalHours;
      patch.status = "complete";
    }

    if ((patch.clockOutAt || patch.clockOut) && !(patch.breaks || before.breaks)) {
      // keep existing behavior
    }

    if (patch.clockOutAt || patch.clockOut) {
      const tmp = { ...before, ...patch };
      const check = await evaluateMealBreakCompliance({ timeEntry: tmp, now: new Date() });
      if (check?.hardStop) {
        return res.status(400).json({ error: { message: "Meal break required before clock-out" } });
      }
    }

    const updated = await TimeEntry.findByIdAndUpdate(req.params.id, patch, {
      new: true,
    }).lean();

    if (!updated) {
      return res.status(404).json({ error: { message: "Time entry not found" } });
    }

    await writeAuditLogs({
      timeEntryId: String(updated._id),
      before,
      after: updated,
      editedByUserId: String(req.user?.sub || ""),
      ipAddress: getClientIp(req),
    });
    
    // Create notification
    await createNotification({
      actor: req.user?.name || req.user?.username || "Admin",
      actorRole: req.user?.role || "admin",
      action: "updated",
      resourceType: "time entry",
      resourceName: updated.employee,
      resourceId: String(req.params.id),
    });

    if (updated.clockOutAt || updated.clockOut) {
      const refDate = updated.date || new Date();
      const weekStart = startOfWeekISO(refDate);
      const weekEnd = endOfWeekISO(refDate);
      const weekEntries = await TimeEntry.find({
        employee: updated.employee,
        date: { $gte: new Date(`${weekStart}T00:00:00.000Z`), $lte: new Date(`${weekEnd}T23:59:59.999Z`) },
      }).lean();

      let hourlyRate = Number(updated.hourlyRate) || 0;
      if (!hourlyRate) {
        const emp = await Employee.findOne({ name: updated.employee }).lean();
        const rate = Number(String(emp?.payRate || "").replace(/[^0-9.]/g, ""));
        if (Number.isFinite(rate)) hourlyRate = rate;
      }

      await evaluateOvertimeCompliance({
        employee: updated.employee,
        userId: updated.userId,
        timeEntries: weekEntries,
        hourlyRate,
        stateCode: updated.stateCode,
        refDate,
      });
    }

    return res.json({ item: withId(updated) });
  } catch (err) {
    return next(err);
  }
});

router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const deleted = await TimeEntry.findByIdAndDelete(req.params.id).lean();
    if (!deleted) {
      return res.status(404).json({ error: { message: "Time entry not found" } });
    }
    
    // Create notification
    Promise.allSettled([
      createNotification({
        actor: req.user?.name || req.user?.username || "Admin",
        actorRole: req.user?.role || "admin",
        action: "deleted",
        resourceType: "time entry",
        resourceName: deleted.employee,
        resourceId: String(req.params.id),
      }),
      cacheDel("time-entries:list:*")
    ]).catch(() => {});
    
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

// Admin endpoints for scrum records

// GET /api/time-entries/scrum-records - Get all scrum records for all employees (admin only)
router.get("/scrum-records", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const { from, to, employee, page = 1, limit = 50 } = req.query;

    const matchStage = {
      scrum: { $exists: true, $ne: "" },
    };

    // Date range filter
    if (from || to) {
      matchStage.date = {};
      if (from) matchStage.date.$gte = new Date(from);
      if (to) matchStage.date.$lte = new Date(to);
    }

    // Employee filter
    if (employee) {
      matchStage.employee = { $regex: escapeRegex(employee), $options: "i" };
    }

    const pipeline = [
      { $match: matchStage },
      { $sort: { date: -1 } },
      {
        $group: {
          _id: "$employee",
          records: {
            $push: {
              id: "$_id",
              date: "$date",
              clockIn: "$clockIn",
              clockOut: "$clockOut",
              totalHours: "$totalHours",
              scrum: "$scrum",
              createdAt: "$createdAt",
            },
          },
          count: { $sum: 1 },
          latestRecord: { $first: "$date" },
        },
      },
      { $sort: { latestRecord: -1 } },
    ];

    const results = await TimeEntry.aggregate(pipeline);

    // Get employee details for each group
    const employeeDetails = await Promise.all(
      results.map(async (group) => {
        const emp = await Employee.findOne(
          { name: group._id },
          { name: 1, email: 1, company: 1, phone: 1, status: 1 }
        ).lean();

        return {
          employeeName: group._id,
          employeeId: emp ? String(emp._id) : null,
          email: emp?.email || "",
          company: emp?.company || "",
          phone: emp?.phone || "",
          status: emp?.status || "unknown",
          totalScrumRecords: group.count,
          latestRecord: group.latestRecord,
          records: group.records,
        };
      })
    );

    return res.json({
      success: true,
      items: employeeDetails,
      total: employeeDetails.length,
    });
  } catch (err) {
    return next(err);
  }
});

// GET /api/time-entries/scrum-records/:employeeName - Get scrum records for a specific employee (admin only)
router.get("/scrum-records/:employeeName", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const { employeeName } = req.params;
    const { from, to, page = 1, limit = 50 } = req.query;

    const matchStage = {
      employee: decodeURIComponent(employeeName),
      scrum: { $exists: true, $ne: "" },
    };

    // Date range filter
    if (from || to) {
      matchStage.date = {};
      if (from) matchStage.date.$gte = new Date(from);
      if (to) matchStage.date.$lte = new Date(to);
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [records, total] = await Promise.all([
      TimeEntry.find(matchStage)
        .sort({ date: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      TimeEntry.countDocuments(matchStage),
    ]);

    const items = records.map((entry) => ({
      id: String(entry._id),
      date: entry.date,
      clockIn: entry.clockIn,
      clockOut: entry.clockOut,
      totalHours: entry.totalHours,
      scrum: entry.scrum,
      createdAt: entry.createdAt,
    }));

    return res.json({
      success: true,
      items,
      total,
      page: Number(page),
      limit: Number(limit),
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
