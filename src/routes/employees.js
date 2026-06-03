const express = require("express");
const { z } = require("zod");
const bcrypt = require("bcryptjs");

const Employee = require("../models/Employee");
const Task = require("../models/Task");
const Event = require("../models/Event");
const TimeEntry = require("../models/TimeEntry");
const Message = require("../models/Message");
const ActivityLog = require("../models/ActivityLog");
const Settings = require("../models/Settings");
const EODReport = require("../models/EODReport");
const { createNotification } = require("../utils/notifications");
const { requireAuth, requireRole } = require("../middleware/auth");
const PayrollRecord = require("../models/employee/PayrollRecord");
const EmpDocument = require("../models/employee/EmpDocument");
const TaxDocument = require("../models/employee/TaxDocument");

const multer = require("multer");
const path = require("path");
const fs = require("fs");
const jwt = require("jsonwebtoken");


const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const employeeId = req.employee?._id;

    console.log("EMPLOYEE IN MULTER:", employeeId);

    if (!employeeId) {
      return cb(new Error("Employee not found"), "");
    }

    const { docType } = req.body;

    let folder = "docs";

    if (docType === "W-4" || docType === "I-9") {
      folder = "tax";
    } else if (docType === "Payslip") {
      folder = "payroll";
    }

    const dir = `uploads/employees/${employeeId}/${folder}`;

    console.log("FINAL DIR:", dir);

    fs.mkdirSync(dir, { recursive: true });

    cb(null, dir);
  },

  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const name =
      Date.now() + "-" + Math.random().toString(36).substring(7);

    cb(null, name + ext);
  },
});

const upload = multer({ storage });


const { parsePagination, paginatedResponse } = require("../lib/pagination");
const { cacheWrap, cacheDel } = require("../lib/cache");
const router = express.Router();

const createSchema = z.object({
  name: z.string().min(1),
  initials: z.string().optional().default(""),
  email: z.string().min(1),
  phone: z.string().optional().default(""),
  category: z.string().optional().default(""),
  role: z.string().optional().default(""),
  company: z.string().optional().default(""),
  location: z.string().optional().default(""),
  status: z.enum(["active", "inactive", "on-leave"]).optional(),
  payType: z.enum(["hourly", "monthly"]).optional().default("hourly"),
  payRate: z.string().optional().default(""),
  shift: z.string().optional().default(""),
  hireDate: z.string().optional().default(""),
  joinDate: z.union([z.string(), z.date()]).optional(),
  department: z.string().optional().default(""),
  userRole: z.string().optional().default(""),
  userStatus: z.string().optional().default("active"),
  password: z.string().min(1),
});

const updateSchema = createSchema
  .omit({ password: true })
  .extend({ password: z.string().min(1).optional() })
  .partial();

function withId(doc) {
  if (!doc) return doc;
  const { password, passwordHash, ...rest } = doc;
  return { ...rest, id: String(doc._id) };
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getDayRange(d = new Date()) {
  const start = new Date(d);
  start.setHours(0, 0, 0, 0);
  const end = new Date(d);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

async function requireEmployeeSelf(req, res) {
  const role = String(req.user?.role || "").trim().toLowerCase();
  const allowedRoles = new Set(["employee", "manager", "team-lead"]);
  if (!allowedRoles.has(role)) {
    res.status(403).json({ error: { message: "Forbidden" } });
    return null;
  }

  const userId = String(req.user?.sub || "").trim();
  if (!userId) {
    res.status(401).json({ error: { message: "Unauthorized" } });
    return null;
  }

  const username = String(req.user?.username || "").trim();
  const name = String(req.user?.name || "").trim();
  const email = String(req.user?.email || "").trim();
  const normalizedCandidates = [username, name, email].map((v) => v.toLowerCase()).filter(Boolean);

  // Primary path: employee JWT uses Employee._id in `sub`.
  let employee = await Employee.findById(userId, { passwordHash: 0 }).lean();

  // Fallback path: if token `sub` points to another collection, resolve by email/name.
  if (!employee && normalizedCandidates.length > 0) {
    const candidateRegexes = normalizedCandidates.map((c) => new RegExp(`^${escapeRegExp(c)}$`, "i"));
    employee = await Employee.findOne(
      {
        $or: [
          { email: { $in: candidateRegexes } },
          { name: { $in: candidateRegexes } },
          { username: { $in: candidateRegexes } },
        ],
      },
      { passwordHash: 0 }
    ).lean();
  }

  // Last resort: search by any partial match for managers who might have been created manually
  if (!employee && normalizedCandidates.length > 0) {
    const anyCandidate = normalizedCandidates[0];
    employee = await Employee.findOne(
      {
        $or: [
          { email: new RegExp(escapeRegExp(anyCandidate), "i") },
          { name: new RegExp(escapeRegExp(anyCandidate), "i") },
        ],
      },
      { passwordHash: 0 }
    ).lean();
  }

  if (!employee) {
    res.status(404).json({ error: { message: "Employee not found" } });
    return null;
  }

  const user = {
    _id: employee._id,
    username: username || employee.email || employee.name || "",
    email: email || employee.email || "",
    name: name || employee.name || "",
    role,
  };

  return { user, employee };
}

// Employee self endpoints
 router.get("/me", requireAuth, async (req, res, next) => {
   try {
     const ctx = await requireEmployeeSelf(req, res);
     if (!ctx) return;
     const { user, employee } = ctx;

    const userId = String(user._id || "");
    const settings = userId ? await Settings.findOne({ userId }, { avatarUrl: 1, avatarDataUrl: 1 }).lean() : null;
    const avatarUrl = String(settings?.avatarUrl || settings?.avatarDataUrl || "").trim();



   
    res.json({
      item: {
        id: String(employee._id),
        name: employee.name,
        email: employee.email,
        phone: employee.phone || "",
        company: employee.company || "",
        location: employee.location || "",
        status: employee.status || "active",
        avatarUrl: avatarUrl || undefined,
        username: user.username || user.email || "",
        role: user.role || "employee",

        payType: employee.payType || "hourly",
        payRate: employee.payRate || "0",
 current_status: employee.current_status || "AVAILABLE",
        lunch_start_time: employee.lunch_start_time || null,
        lunch_expected_end: employee.lunch_expected_end || null,
        break_start_time: employee.break_start_time || null,
          bankInfo: employee.bankInfo || {
          accountName: "",
          accountNumber: "",
          ifsc: "",
          bankName: "",
        },

        
        taxSettings: employee.taxSettings || {
          pan: "",
          tds: "",
          regime: "",
        },

       },
     });
   } catch (err) {
     next(err);
   }
 });



router.get("/me/tasks", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeSelf(req, res);
    if (!ctx) return;
    const { user, employee } = ctx;

    const candidates = [employee.name, employee.email, user.username]
      .map((s) => String(s || "").trim())
      .filter(Boolean);

    // Build case-insensitive regex conditions for assignees array matching
    const assigneeConditions = candidates.flatMap((c) => [
      { assignees: { $elemMatch: { $regex: new RegExp(`^${escapeRegExp(c)}$`, "i") } } },
      { assignee: { $regex: new RegExp(`^${escapeRegExp(c)}$`, "i") } },
    ]);

    const query = assigneeConditions.length > 0 ? { $or: assigneeConditions } : { _id: null };

    const tasks = await Task.find(query)
      .sort({ updatedAt: -1 })
      .lean();

    res.json({
      items: tasks.map((t) => ({
        id: String(t._id),
        title: t.title,
        description: t.description || "",
        status: t.status,
        priority: t.priority,
        dueDate: t.dueDate ? new Date(t.dueDate).toISOString().slice(0, 10) : "",
        createdAt: t.createdAt || "",
        dueTime: t.dueTime || "",
        assignees: Array.isArray(t.assignees)
          ? t.assignees
          : typeof t.assignee === "string" && t.assignee.trim()
            ? [t.assignee.trim()]
            : [],
        attachmentFileName: t.attachmentFileName || "",
        attachment: t.attachment || null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/me/time-logs", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeSelf(req, res);
    if (!ctx) return;
    const { employee } = ctx;

    const entries = await TimeEntry.find({ employee: employee.name })
      .sort({ date: -1 })
      .limit(50)
      .lean();

    const items = entries.map((entry) => ({
      id: String(entry._id),
      date: entry.date,
      clock_in: entry.clockInAt || entry.clockIn || "",
      clock_out: entry.clockOutAt || entry.clockOut || "",
      total_hours: Number(entry.totalHours || 0),
      status: entry.clockOutAt || entry.clockOut ? "completed" : "active",
    }));

    res.json({ success: true, items });
  } catch (err) {
    next(err);
  }
});

router.get("/me/time-logs/summary", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeSelf(req, res);
    if (!ctx) return;
    const { employee } = ctx;

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    
    // Calculate start of week without mutating 'now'
    const startOfWeek = new Date(startOfToday);
    const day = startOfWeek.getDay();
    const diff = day === 0 ? -6 : 1 - day; // Adjust to Monday
    startOfWeek.setDate(startOfWeek.getDate() + diff);

    const allEntries = await TimeEntry.find({ employee: employee.name }).lean();

    const summary = {
      today: 0,
      thisWeek: 0,
      thisMonth: 0,
      allTime: 0,
    };

    allEntries.forEach((entry) => {
      const entryDate = new Date(entry.date);
      const hours = Number(entry.totalHours || 0);

      summary.allTime += hours;
      if (entryDate >= startOfToday) {
        summary.today += hours;
      }
      if (entryDate >= startOfWeek) {
        summary.thisWeek += hours;
      }
      if (entryDate >= startOfMonth) {
        summary.thisMonth += hours;
      }
    });

    res.json({ success: true, item: summary });
  } catch (err) {
    next(err);
  }
});

router.get("/me/schedule", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeSelf(req, res);
    if (!ctx) return;
    const { employee } = ctx;

    const items = await Event.find({ assignee: employee.name }).sort({ createdAt: -1 }).lean();

    res.json({
      items: items.map((e) => ({
        id: String(e._id),
        title: e.title,
        day: e.day,
        location: e.location,
        startTime: e.startTime,
        endTime: e.endTime,
        type: e.type,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/me/time-entry/today", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeSelf(req, res);
    if (!ctx) return;
    const { employee, user } = ctx;
    const { start, end } = getDayRange(new Date());

    const entry = await TimeEntry.findOne({
      employee: employee.name,
      date: { $gte: start, $lte: end },
    })
      .sort({ createdAt: -1 })
      .lean();

    if (!entry) {
      return res.json({ item: null });
    }

    res.json({
      item: {
        id: String(entry._id),
        employee: entry.employee,
        date: entry.date ? new Date(entry.date).toISOString().slice(0, 10) : "",
        clockIn: entry.clockIn || "",
        clockOut: entry.clockOut || "",
        clockInAt: entry.clockInAt || null,
        clockOutAt: entry.clockOutAt || null,
        totalHours: Number(entry.totalHours || 0),
        status: entry.status || "",
        userId: entry.userId || String(user._id),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post("/me/clock-in", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeSelf(req, res);
    if (!ctx) return;
    const { employee, user } = ctx;

    // Check onboarding status
    const Onboarding = require("../models/Onboarding");
    const onboarding = await Onboarding.findOne({ userId: user._id });
    if (!onboarding || onboarding.overallStatus !== "approved") {
      return res.status(403).json({
        error: {
          message: "Complete onboarding and receive admin approval before clocking in",
        },
      });
    }

    const { start, end } = getDayRange(new Date());
    const existing = await TimeEntry.findOne({ employee: employee.name, date: { $gte: start, $lte: end } })
      .sort({ createdAt: -1 })
      .lean();

    if (existing && (existing.clockInAt || existing.clockIn)) {
      return res.status(400).json({ error: { message: "Already clocked in for today" } });
    }

    const now = new Date();
    const hhmm = now.toTimeString().slice(0, 5);

    const created = await TimeEntry.create({
      userId: String(user._id),
      employee: employee.name,
      date: now,
      clockIn: hhmm,
      clockInAt: now,
      clockOut: "",
      status: "incomplete",
      location: employee.location || "",
    });

    res.status(201).json({
      item: {
        id: String(created._id),
        date: created.date ? new Date(created.date).toISOString().slice(0, 10) : "",
        clockIn: created.clockIn || "",
        clockOut: created.clockOut || "",
        status: created.status || "",
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post("/me/clock-out", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeSelf(req, res);
    if (!ctx) return;
    const { employee } = ctx;

    const { start, end } = getDayRange(new Date());
    const entry = await TimeEntry.findOne({ employee: employee.name, date: { $gte: start, $lte: end } }).sort({ createdAt: -1 });

    if (!entry) {
      return res.status(400).json({ error: { message: "No active time entry for today" } });
    }

    if ((entry.clockOutAt || entry.clockOut) && String(entry.clockOut || "").trim()) {
      return res.status(400).json({ error: { message: "Already clocked out for today" } });
    }

    const now = new Date();
    entry.clockOutAt = now;
    entry.clockOut = now.toTimeString().slice(0, 5);
    entry.status = "complete";
    await entry.save();

    res.json({
      item: {
        id: String(entry._id),
        date: entry.date ? new Date(entry.date).toISOString().slice(0, 10) : "",
        clockIn: entry.clockIn || "",
        clockOut: entry.clockOut || "",
        status: entry.status || "",
        totalHours: Number(entry.totalHours || 0),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get("/me/dashboardddd", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeSelf(req, res);
    if (!ctx) return;
    const { employee, user } = ctx;

    const candidates = [employee.name, employee.email, user.username]
      .map((s) => String(s || "").trim())
      .filter(Boolean);

    const candidateRegexes = candidates.map((c) => new RegExp(`^${escapeRegExp(c)}$`, "i"));

    const { start, end } = getDayRange(new Date());

    const [tasks, schedule, todayEntry, unreadMessages] = await Promise.all([
      Task.find({
        $or: [
          { assignees: { $in: candidates } },
          { assignees: { $in: candidateRegexes } },
          { assignee: { $in: candidates } },
          { assignee: { $in: candidateRegexes } },
        ],
      })
        .sort({ updatedAt: -1 })
        .lean(),
      Event.find({ assignee: employee.name }).sort({ createdAt: -1 }).limit(10).lean(),
      TimeEntry.findOne({ employee: employee.name, date: { $gte: start, $lte: end } }).sort({ createdAt: -1 }).lean(),
      Message.countDocuments({ type: "direct", recipient: employee.name, status: { $ne: "read" } }),
    ]);

    const totalTasks = tasks.length;
    const completedTasks = tasks.filter((t) => String(t.status || "").toLowerCase() === "completed").length;
    const pendingTasks = tasks.filter((t) => String(t.status || "").toLowerCase() === "pending").length;
    const inProgressTasks = tasks.filter((t) => String(t.status || "").toLowerCase() === "in-progress").length;

    res.json({
      item: {
        tasks: {
          total: totalTasks,
          completed: completedTasks,
          pending: pendingTasks,
          inProgress: inProgressTasks,
        },
        clock: {
          clockIn: todayEntry?.clockIn || "",
          clockOut: todayEntry?.clockOut || "",
          status: todayEntry?.status || "",
        },
        scheduleCount: schedule.length,
        unreadMessages: Number(unreadMessages || 0),
        recentTasks: tasks
          .slice()
          .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))
          .slice(0, 5)
          .map((t) => ({
            id: String(t._id),
            title: t.title,
            status: t.status,
            priority: t.priority,
            dueDate: t.dueDate ? new Date(t.dueDate).toISOString().slice(0, 10) : "",
          })),
      },
    });
  } catch (err) {
    next(err);
  }
});


router.get("/me/dashboard", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeSelf(req, res);
    if (!ctx) return;

    const { employee, user } = ctx;

    const REQUIRED_DOCS = ["W-4", "I-9", "Agreement"];

    const candidates = [employee.name, employee.email, user.username]
      .map((s) => String(s || "").trim())
      .filter(Boolean);

    const candidateRegexes = candidates.map(
      (c) => new RegExp(`^${escapeRegExp(c)}$`, "i")
    );

    const { start, end } = getDayRange(new Date());

    const [
      tasks,
      schedule,
      todayEntry,
      unreadMessages,
      payrollAgg,
      timeLogsAgg,
      documents,
    ] = await Promise.all([
      Task.find({
        $or: [
          { assignees: { $in: candidates } },
          { assignees: { $in: candidateRegexes } },
          { assignee: { $in: candidates } },
          { assignee: { $in: candidateRegexes } },
        ],
      }).sort({ updatedAt: -1 }).lean(),

      Event.find({ assignee: employee.name })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),

      TimeEntry.findOne({
        employee: employee.name,
        date: { $gte: start, $lte: end },
      }).sort({ createdAt: -1 }).lean(),

      Message.countDocuments({
        type: "direct",
        recipient: employee.name,
        status: { $ne: "read" },
      }),

      PayrollRecord.aggregate([
        { $match: { employeeId: employee._id } },
        { $group: { _id: null, totalEarnings: { $sum: "$net" } } },
      ]),

      TimeEntry.aggregate([
        { $match: { employee: employee.name } },
        { $group: { _id: null, totalHours: { $sum: "$totalHours" } } },
      ]),

      EmpDocument.find({ employeeId: employee._id }).lean(),
    ]);

    // =========================
    // TASK STATS
    // =========================
    const totalTasks = tasks.length;
    const completedTasks = tasks.filter(
      (t) => String(t.status).toLowerCase() === "completed"
    ).length;

    const pendingTasks = tasks.filter(
      (t) => String(t.status).toLowerCase() === "pending"
    ).length;

    const inProgressTasks = tasks.filter(
      (t) => String(t.status).toLowerCase() === "in-progress"
    ).length;

    // =========================
    // PAYROLL + HOURS
    // =========================
    const earnings = payrollAgg[0]?.totalEarnings || 0;
    const hoursWorked = timeLogsAgg[0]?.totalHours || 0;

    // =========================
    // DOCUMENT MAP (IMPORTANT FIX)
    // =========================
    const docMap = {};
    documents.forEach((d) => {
      docMap[d.docType] = d;
    });

    // =========================
    // ALERTS (FIXED LOGIC)
    // =========================
    const alerts = [];

    REQUIRED_DOCS.forEach((type) => {
      const doc = docMap[type];

      if (!doc) {
        alerts.push(`Missing ${type} document`);
      } else if (doc.status === "completed") {
        alerts.push(`${type} document: Completed`);
      } else if (doc.status === "pending") {
        alerts.push(`${type} document: Pending approval`);
      } else {
        alerts.push(`${type} document: ${doc.status}`);
      }
    });

    if (!earnings) alerts.push("No payroll records found");

    // =========================
    // ACTIONS
    // =========================
    const actions = [];

    if (!earnings) {
      actions.push({ type: "add_payroll", label: "Add Payroll Info" });
    }

    if (!hoursWorked) {
      actions.push({ type: "add_time", label: "Add Time Log" });
    }

    if (REQUIRED_DOCS.some((t) => !docMap[t])) {
      actions.push({ type: "upload_docs", label: "Upload Documents" });
    }

    // =========================
    // RESPONSE
    // =========================
    res.json({
      item: {
        earnings,
        hoursWorked,
        alerts,
        actions,

        tasks: {
          total: totalTasks,
          completed: completedTasks,
          pending: pendingTasks,
          inProgress: inProgressTasks,
        },

        clock: {
          clockIn: todayEntry?.clockIn || "",
          clockOut: todayEntry?.clockOut || "",
          status: todayEntry?.status || "",
        },

        scheduleCount: schedule.length,
        unreadMessages: Number(unreadMessages || 0),

        recentTasks: tasks
          .slice()
          .sort(
            (a, b) =>
              new Date(b.updatedAt || b.createdAt || 0) -
              new Date(a.updatedAt || a.createdAt || 0)
          )
          .slice(0, 5)
          .map((t) => ({
            id: String(t._id),
            title: t.title,
            status: t.status,
            priority: t.priority,
            dueDate: t.dueDate
              ? new Date(t.dueDate).toISOString().slice(0, 10)
              : "",
          })),
      },
    });
  } catch (err) {
    next(err);
  }
});

// Helper to log activity
async function logActivity(req, action, resourceType, resourceId, resourceName, description) {
  try {
    await ActivityLog.create({
      actorUserId: String(req.user?.sub || req.user?.id || "unknown"),
      actorUsername: String(req.user?.username || req.user?.name || "unknown"),
      actorRole: String(req.user?.role || "unknown"),
      action,
      resourceType,
      resourceId: String(resourceId || ""),
      resourceName: String(resourceName || ""),
      description: String(description || ""),
      ipAddress: String(req.ip || req.headers["x-forwarded-for"] || ""),
      userAgent: String(req.headers["user-agent"] || ""),
      metadata: { body: req.body },
    });
  } catch (err) {
    console.error("Failed to log activity:", err);
  }
}

router.get("/", requireAuth, async (_req, res, next) => {
  try {
    const result = await cacheWrap('employees:list', async () => {
      const items = await Employee.find().sort({ name: 1 }).lean();

      // Resolve avatars from Settings keyed by Employee._id
      const empIds = items.map((e) => String(e._id));
      const settings = empIds.length
        ? await Settings.find({ userId: { $in: empIds } })
            .select("userId avatarUrl avatarDataUrl")
            .lean()
        : [];

      const idToAvatar = new Map(
        settings.map((s) => [String(s.userId), String(s.avatarDataUrl || s.avatarUrl || "").trim()])
      );

      const itemsWithAvatars = items.map((e) => {
        const avatarUrl = idToAvatar.get(String(e._id)) || "";
        return { ...e, avatarUrl, avatarDataUrl: avatarUrl };
      });

      return { items: itemsWithAvatars.map(withId) };
    }, 60);

    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/", requireAuth, async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload" } });
    }

    const joinDateSource = parsed.data.joinDate || parsed.data.hireDate;
    const joinDate = joinDateSource ? new Date(joinDateSource) : undefined;
    const initials =
      parsed.data.initials ||
      parsed.data.name
        .split(" ")
        .map((n) => n[0])
        .slice(0, 2)
        .join("")
        .toUpperCase();

    const passwordHash = await bcrypt.hash(parsed.data.password, 10);

    const { password, ...employeePayload } = parsed.data;

    const created = await Employee.create({
      ...employeePayload,
      initials,
      joinDate,
      passwordHash,
    });

const obj = created.toObject();
    
    // Fire-and-forget side effects
    Promise.allSettled([
      logActivity(req, "EMPLOYEE_CREATE", "employee", created._id, created.name, `Created employee: ${created.name}`),
      createNotification({
        actor: req.user?.name || req.user?.username || "Admin",
        actorRole: req.user?.role || "admin",
        action: "created",
        resourceType: "employee",
        resourceName: created.name,
        resourceId: String(created._id),
      }),
      cacheDel("employees:list"),
    ]).catch(() => {});
    
    return res.status(201).json({ item: withId(obj) });
  } catch (err) {
    return next(err);
  }
});

router.put("/:id", requireAuth, async (req, res, next) => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload" } });
    }

    const patch = { ...parsed.data };

    if (typeof patch.password === "string" && patch.password.trim()) {
      patch.passwordHash = await bcrypt.hash(patch.password, 10);
    }

    if (typeof patch.password === "string") delete patch.password;

    const joinDateSource = patch.joinDate || patch.hireDate;
    if (joinDateSource) patch.joinDate = new Date(joinDateSource);
    if (typeof patch.hireDate === "string") delete patch.hireDate;

    if (!patch.initials && typeof patch.name === "string" && patch.name.trim()) {
      patch.initials = patch.name
        .split(" ")
        .map((n) => n[0])
        .slice(0, 2)
        .join("")
        .toUpperCase();
    }

    const updated = await Employee.findByIdAndUpdate(req.params.id, patch, {
      new: true,
    }).lean();

    if (!updated) {
      return res.status(404).json({ error: { message: "Employee not found" } });
    }

    // Log activity
    await logActivity(req, "EMPLOYEE_UPDATE", "employee", req.params.id, updated.name, `Updated employee: ${updated.name}`);

    if (patch.status === "inactive") {
      const archived = await archiveEmployeeById(req.params.id, req.user);
      if (archived) {
         // Create notification
        await createNotification({
          actor: req.user?.name || req.user?.username || "Admin",
          actorRole: req.user?.role || "admin",
          action: "archived (deactivated)",
          resourceType: "employee",
          resourceName: archived.name,
          resourceId: String(req.params.id),
        });
        cacheDel("employees:list");
        return res.json({ item: withId(archived), archived: true });
      }
    }

    await cacheDel("employees:list");

    // Create notification for all admin/manager users
    await createNotification({
      actor: req.user?.name || req.user?.username || "Admin",
      actorRole: req.user?.role || "admin",
      action: "updated",
      resourceType: "employee",
      resourceName: updated.name,
      resourceId: String(req.params.id),
    });

    const s = await Settings.findOne({ userId: String(updated._id) }).lean();
    const avatarUrl = s?.avatarDataUrl || s?.avatarUrl || "";

    return res.json({ item: { ...withId(updated), avatarUrl, avatarDataUrl: avatarUrl } });
  } catch (err) {
    return next(err);
  }
});

async function archiveEmployeeById(employeeId, archivedBy) {
  const Archive = require("../models/Archive");
  
  const employee = await Employee.findById(employeeId).lean();
  if (!employee) return null;

  await Archive.create({
    itemType: "employee",
    itemData: {
      originalId: String(employee._id),
      ...employee,
    },
    parentType: "organization",
    parentId: "system",
    parentName: "Employees",
    archivedByUserId: String(archivedBy.sub || archivedBy.id || ""),
    archivedByUsername: String(archivedBy.username || archivedBy.name || ""),
    archivedByRole: String(archivedBy.role || ""),
  });

  // Remove from Tasks and Projects
    try {
      const Task = require('../models/Task');
      const Project = require('../models/Project');
      const targets = [employee.name, employee.email].filter(Boolean);
      if (targets.length > 0) {
        if (Task) await Task.updateMany({ assignees: { $in: targets } }, { $pull: { assignees: { $in: targets } } });
        if (Project) await Project.updateMany({ assignees: { $in: targets } }, { $pull: { assignees: { $in: targets } } });
      }
    } catch (err) {
      console.error('Failed to unassign employee', err);
    }

  await Employee.findByIdAndDelete(employeeId);
  
  return employee;
}

router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const deleted = await archiveEmployeeById(req.params.id, req.user);
    if (!deleted) {
      return res.status(404).json({ error: { message: "Employee not found" } });
    }
    
    // Log activity
    await logActivity(req, "EMPLOYEE_ARCHIVE", "employee", req.params.id, deleted.name, `Archived (Deleted) employee: ${deleted.name}`);
    
    // Create notification
    await createNotification({
      actor: req.user?.name || req.user?.username || "Admin",
      actorRole: req.user?.role || "admin",
      action: "archived",
      resourceType: "employee",
      resourceName: deleted.name,
      resourceId: String(req.params.id),
    });
    
    cacheDel("employees:list");
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

// Super Admin: Reset Employee Password
router.post("/:id/reset-password", requireAuth, requireRole(["super-admin"]), async (req, res, next) => {
  try {
    const resetSchema = z.object({
      newPassword: z.string().min(6, "Password must be at least 6 characters"),
      confirmPassword: z.string().min(1, "Confirm password is required"),
    });

    const parsed = resetSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: parsed.error.errors[0]?.message || "Invalid payload" } });
    }

    const { newPassword, confirmPassword } = parsed.data;

    // Validate passwords match
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ error: { message: "Passwords do not match" } });
    }

    // Hash the new password
    const passwordHash = await bcrypt.hash(newPassword, 10);

    // Update employee password
    const updated = await Employee.findByIdAndUpdate(
      req.params.id,
      { passwordHash },
      { new: true }
    ).lean();

    if (!updated) {
      return res.status(404).json({ error: { message: "Employee not found" } });
    }

    return res.json({ success: true, message: "Password reset successfully" });
  } catch (err) {
    return next(err);
  }
});





router.get("/me/payroll", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeSelf(req, res);
    if (!ctx) return;

    const { employee } = ctx;

    const records = await PayrollRecord.find({
      employeeId: employee._id,
    })
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      items: records.map((r) => ({
        id: String(r._id),
        payPeriod: r.payPeriod,
        gross: r.gross,
        net: r.net,
        taxes: r.taxes,
        deductions: r.deductions,
        pdfUrl: r.pdfUrl, // S3 pre-signed URL
      })),
    });
  } catch (err) {
    next(err);
  }
});





router.get("/me/tax-docs", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeSelf(req, res);
    if (!ctx) return;

    const { employee } = ctx;
    const { year } = req.query;

    const query = { employeeId: employee._id };
    if (year) query.year = Number(year);

    const docs = await TaxDocument.find(query).lean();

    res.json({
      items: docs.map((d) => ({
        id: String(d._id),
        year: d.year,
        type: d.type,
        fileUrl: d.fileUrl,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/me/time-logs", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeSelf(req, res);
    if (!ctx) return;

    const { employee } = ctx;

    const logs = await TimeEntry.find({
      employee: employee.name,
    })
      .sort({ date: -1 })
      .lean();

    res.json({
      items: logs.map((l) => ({
        id: String(l._id),
        date: l.date,
        clockIn: l.clockIn,
        clockOut: l.clockOut,
        totalHours: l.totalHours,
      })),
    });
  } catch (err) {
    next(err);
  }
});




router.get("/me/documents", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeSelf(req, res);
    if (!ctx) return;

    const { employee } = ctx;

    const docs = await EmpDocument.find({
      employeeId: employee._id,
    }).lean();

    res.json({
      items: docs.map((d) => ({
        id: String(d._id),
        docType: d.docType,
        status: d.status,
        fileUrl: d.fileUrl,
      })),
    });
  } catch (err) {
    next(err);
  }
});


/*router.post("/me/documents", requireAuth, async (req, res) => {
  const ctx = await requireEmployeeSelf(req, res);
  if (!ctx) return;

  const { employee } = ctx;
  const { docType, file } = req.body;

  const created = await EmpDocument.create({
    employeeId: employee._id,
    docType,
    status: "pending",
    fileUrl: file, // later replace with S3
  });

  res.json({ item: created });
});*/


router.post(
  "/me/documents",
  requireAuth,
  async (req, res, next) => {
    const ctx = await requireEmployeeSelf(req, res);
    if (!ctx) return;

    req.employee = ctx.employee; 
    next(); 
  },
  upload.single("file"), 
  async (req, res) => {
    console.log("EMPLOYEE:", req.employee); 

    const created = await EmpDocument.create({
      employeeId: req.employee._id,
      docType: req.body.docType,
      status: "pending",
      fileUrl: `${req.protocol}://${req.get("host")}/${req.file.path}`,
    });

    res.json({
      item: {
        id: created._id,
        docType: created.docType,
        status: created.status,
        fileUrl: created.fileUrl,
      },
    });
  }
);

router.put("/me/profile", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeSelf(req, res);
    if (!ctx) return;

    const { employee } = ctx;

    const updated = await Employee.findByIdAndUpdate(
      employee._id,
      req.body,
      { new: true }
    ).lean();

    res.json({ item: updated });
  } catch (err) {
    next(err);
  }
});
// GET /api/employees/me/time-entry/history - Get employee time entry history
router.get("/me/time-entry/history", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeSelf(req, res);
    if (!ctx) return;
    const { employee } = ctx;

    const entries = await TimeEntry.find({ employee: employee.name })
      .sort({ date: -1 })
      .limit(50)
      .lean();

    const items = entries.map((entry) => ({
      id: String(entry._id),
      date: entry.date,
      clockIn: entry.clockIn,
      clockOut: entry.clockOut,
      clockInAt: entry.clockInAt,
      clockOutAt: entry.clockOutAt,
      totalHours: entry.totalHours,
      status: entry.clockOut ? "completed" : "active",
      scrum: entry.scrum || null,
    }));

    return res.json({ success: true, items });
  } catch (err) {
    return next(err);
  }
});

// POST /api/employees/me/clock-out-with-scrum - Clock out with scrum details
router.post("/me/clock-out-with-scrum", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeSelf(req, res);
    if (!ctx) return;
    const { employee, user } = ctx;
    const { scrum } = req.body;

    if (!scrum || !scrum.trim()) {
      return res.status(400).json({ success: false, message: "Scrum details are required" });
    }

    const { start, end } = getDayRange(new Date());
    const entry = await TimeEntry.findOne({
      employee: employee.name,
      date: { $gte: start, $lte: end },
    }).sort({ createdAt: -1 });

    if (!entry) {
      return res.status(404).json({ success: false, message: "No active time entry found" });
    }

    if (entry.clockOut) {
      return res.status(400).json({ success: false, message: "Already clocked out" });
    }

    const now = new Date();
    const clockOutTime = now.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    });

    // Calculate total hours
    let totalHours = 0;
    if (entry.clockInAt) {
      const diffMs = now.getTime() - new Date(entry.clockInAt).getTime();
      totalHours = Math.round((diffMs / (1000 * 60 * 60)) * 100) / 100;
    }

    entry.clockOut = clockOutTime;
    entry.clockOutAt = now;
    entry.totalHours = totalHours;
    entry.status = "complete";
    entry.scrum = scrum.trim();

    await entry.save();

    // Automatically create or update EOD report
    try {
      const EODReport = require("../models/EODReport");
      let eodData = null;
      try {
        eodData = JSON.parse(scrum);
      } catch {
        eodData = { tasksCompleted: scrum.trim(), issuesBlockers: "", notes: "" };
      }

      if (eodData) {
        const start = new Date(entry.date);
        start.setHours(0, 0, 0, 0);
        const end = new Date(entry.date);
        end.setHours(23, 59, 59, 999);

        const existingReport = await EODReport.findOne({
          userId: String(user._id),
          date: { $gte: start, $lte: end },
        });

        if (existingReport) {
          existingReport.rawInput = JSON.stringify(eodData);
          existingReport.status = "submitted";
          existingReport.timeEntryId = entry._id;
          await existingReport.save();
        } else {
          await EODReport.create({
            userId: String(user._id),
            employeeId: String(employee._id),
            employeeName: employee.name,
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
      console.error("Failed to sync EOD report on employee clock-out-with-scrum:", err);
    }

    // Create notification for admin
    await createNotification({
      actor: employee.name,
      actorRole: "employee",
      action: "submitted",
      resourceType: "scrum",
      resourceName: "daily report",
      details: "clocked out with scrum details",
      link: `/admin/time-tracking`,
    });

    return res.json({
      success: true,
      item: {
        id: String(entry._id),
        date: entry.date,
        clockIn: entry.clockIn,
        clockOut: entry.clockOut,
        clockInAt: entry.clockInAt,
        clockOutAt: entry.clockOutAt,
        totalHours: entry.totalHours,
        status: entry.status,
        scrum: entry.scrum,
      },
    });
  } catch (err) {
    return next(err);
  }
});

// GET /api/employees/me/scrum-records - Get employee scrum records
router.get("/me/scrum-records", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeSelf(req, res);
    if (!ctx) return;
    const { employee } = ctx;

    const entries = await TimeEntry.find({
      employee: employee.name,
      scrum: { $exists: true, $ne: "" },
    })
      .sort({ date: -1 })
      .limit(100)
      .lean();

    const items = entries.map((entry) => ({
      id: String(entry._id),
      date: entry.date,
      clockIn: entry.clockIn,
      clockOut: entry.clockOut,
      totalHours: entry.totalHours,
      scrum: entry.scrum,
      createdAt: entry.createdAt,
    }));

    return res.json({ success: true, items });
  } catch (err) {
    return next(err);
  }
});

// POST /api/employees/me/eod-report - Submit EOD report
router.post("/me/eod-report", requireAuth, async (req, res, next) => {
  try {
    const schema = z.object({
      tasksCompleted: z.string().min(10, "Tasks completed must be at least 10 characters"),
      issuesBlockers: z.string().optional(),
      notes: z.string().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ 
        error: { 
          message: parsed.error.errors[0]?.message || "Invalid payload" 
        } 
      });
    }

    const ctx = await requireEmployeeSelf(req, res);
    if (!ctx) return;
    const { employee, user } = ctx;

    const { start, end } = getDayRange(new Date());

    // Check if EOD report already exists for today
    const existingReport = await EODReport.findOne({
      userId: String(user._id),
      date: { $gte: start, $lte: end },
    });

    if (existingReport) {
      // Update existing report
      existingReport.rawInput = JSON.stringify(parsed.data);
      existingReport.status = "submitted";
      await existingReport.save();
      
      cacheDel("eod-reports:*").catch(() => {});
      
      return res.json({ item: withId(existingReport.toObject()) });
    }

    // Find today's time entry
    const timeEntry = await TimeEntry.findOne({
      employee: employee.name,
      date: { $gte: start, $lte: end },
    });

    // Create new EOD report
    const dateObj = new Date();
    const eodData = parsed.data;
    const report = await EODReport.create({
      userId: String(user._id),
      employeeId: String(employee._id),
      employeeName: employee.name,
      date: dateObj,
      rawInput: JSON.stringify(eodData),
      inputType: "text",
      status: "submitted",
      timeEntryId: timeEntry?._id || null,
    });

    // Create notification for admin
    await createNotification({
      actor: employee.name,
      actorRole: "employee",
      action: "submitted",
      resourceType: "EOD report",
      resourceName: dateObj.toISOString().split("T")[0],
      details: "end-of-day report",
      link: `/admin/eod-reports`,
    });

    cacheDel("eod-reports:*").catch(() => {});

    return res.status(201).json({ item: withId(report.toObject()) });

  } catch (err) {
    next(err);
  }
});


router.put("/me/profile/bank", requireAuth, async (req, res) => {
  const ctx = await requireEmployeeSelf(req, res);
  if (!ctx) return;

  const updated = await Employee.findByIdAndUpdate(
    ctx.employee._id,
    {
      bankInfo: req.body.bankInfo,
    },
    { new: true }
  );

  res.json({ success: true });
});
router.put("/me/profile/tax", requireAuth, async (req, res) => {
  const ctx = await requireEmployeeSelf(req, res);
  if (!ctx) return;

  const updated = await Employee.findByIdAndUpdate(
    ctx.employee._id,
    {
      taxSettings: req.body.taxSettings,
    },
    { new: true }
  );

  res.json({ success: true });
});

router.get("/me/onboarding-status", requireAuth, async (req, res) => {
  const ctx = await requireEmployeeSelf(req, res);
  if (!ctx) return;

  const docs = await EmpDocument.find({
    employeeId: ctx.employee._id,
  });

  const hasW4 = docs.some(d => d.docType === "W-4" && d.status === "completed");
  const hasI9 = docs.some(d => d.docType === "I-9" && d.status === "completed");

  res.json({
    completed: hasW4 && hasI9,
    missing: [
      !hasW4 && "W-4",
      !hasI9 && "I-9",
    ].filter(Boolean),
  });
});




// GET /api/employees/me/eod-reports - Get employee's EOD reports
router.get("/me/eod-reports", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeSelf(req, res);
    if (!ctx) return;
    const { user } = ctx;

    const { from, to, page = 1, limit = 50 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const matchStage = { userId: String(user._id) };

    // Date range filter
    if (from || to) {
      matchStage.date = {};
      if (from) matchStage.date.$gte = new Date(from);
      if (to) matchStage.date.$lte = new Date(to);
    }

    const [reports, total] = await Promise.all([
      EODReport.find(matchStage)
        .sort({ date: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      EODReport.countDocuments(matchStage),
    ]);

    const items = reports.map((report) => ({
      id: String(report._id),
      userId: report.userId,
      employeeName: report.employeeName,
      date: report.date,
      rawInput: report.rawInput,
      inputType: report.inputType,
      status: report.status,
      createdAt: report.updatedAt || report.createdAt,
    }));

    return res.json({ items, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    next(err);
  }
}
);  

router.post('/me/push-token', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { pushToken } = req.body;

    if (!pushToken) {
      return res.status(400).json({ message: 'Push token required' });
    }

    await Employee.findByIdAndUpdate(userId, {
      pushToken,
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });

  }
});



module.exports = router;
