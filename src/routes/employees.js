const express = require("express");
const { z } = require("zod");
const bcrypt = require("bcryptjs");

const Employee = require("../models/Employee");
const EmployeeEmploymentHistory = require("../models/EmployeeEmploymentHistory");
const EmployeeDocument = require("../models/EmployeeDocument");
const EmployeeAsset = require("../models/EmployeeAsset");
const EmployeeTraining = require("../models/EmployeeTraining");
const EmployeeTimelineEvent = require("../models/EmployeeTimelineEvent");
const EmployeeBankInfo = require("../models/EmployeeBankInfo");
const EmployeeHRNote = require("../models/EmployeeHRNote");
const EmployeeChangeRequest = require("../models/EmployeeChangeRequest");
const ClearHireProfile = require("../models/ClearHireProfile");
const Onboarding = require("../models/Onboarding");
const User = require("../models/User");
const Task = require("../models/Task");
const Event = require("../models/Event");
const TimeEntry = require("../models/TimeEntry");
const Message = require("../models/Message");
const ActivityLog = require("../models/ActivityLog");
const Settings = require("../models/Settings");
const EODReport = require("../models/EODReport");
const { createNotification } = require("../utils/notifications");
const { requireAuth, requireRole } = require("../middleware/auth");
const { parsePagination, paginatedResponse } = require("../lib/pagination");
const { cacheWrap, cacheDel } = require("../lib/cache");
const multer = require("multer");
const { saveToServer, uploadToS3 } = require("../lib/s3");
const { encryptField, decryptField, maskSSN } = require("../utils/encryption");
const { HR_PERMISSIONS, requireHRPermission, canAccessEmployee } = require("../middleware/hrPermissions");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

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
  password: z.string().optional(),
  onboardingRequired: z.boolean().optional(),
  // Extended Employee File Fields
  employeeNumber: z.string().optional(),
  legalName: z.string().optional(),
  preferredName: z.string().optional(),
  personalEmail: z.string().optional(),
  personalPhone: z.string().optional(),
  address: z.any().optional(),
  emergencyContacts: z.array(z.any()).optional(),
  locationId: z.string().nullable().optional(),
  supervisorId: z.string().nullable().optional(),
  rehireDate: z.union([z.string(), z.date()]).nullable().optional(),
  separationDate: z.union([z.string(), z.date()]).nullable().optional(),
  separationReason: z.string().optional(),
  separationType: z.string().nullable().optional(),
  compensation: z.any().optional(),
});

const updateSchema = createSchema
  .omit({ password: true })
  .extend({ password: z.string().min(1).optional() })
  .partial();

async function getNextEmployeeNumber() {
  try {
    const lastEmp = await Employee.findOne({ employeeNumber: { $exists: true, $ne: "" } })
      .sort({ employeeNumber: -1 })
      .select("employeeNumber")
      .lean();
    let nextNum = 1;
    if (lastEmp && lastEmp.employeeNumber) {
      const match = String(lastEmp.employeeNumber).match(/EMP-(\d+)/i);
      if (match) {
        nextNum = parseInt(match[1], 10) + 1;
      }
    }
    return `EMP-${String(nextNum).padStart(4, "0")}`;
  } catch {
    return `EMP-${Date.now().toString().slice(-4)}`;
  }
}

async function recordTimelineEvent(employeeId, eventType, title, description, req, metadata = {}) {
  try {
    const actorId = String(req?.user?.sub || req?.user?.id || "system");
    const actorName = String(req?.user?.name || req?.user?.username || "Admin");
    const actorRole = String(req?.user?.role || "admin");
    await EmployeeTimelineEvent.create({
      employeeId,
      eventType,
      title,
      description,
      eventDate: new Date(),
      actorId,
      actorName,
      actorRole,
      metadata,
    });
  } catch (err) {
    console.error("[Record Timeline Event Error]:", err.message);
  }
}

function withId(doc) {
  if (!doc) return doc;
  const { password, passwordHash, ...rest } = doc;
  return { ...rest, id: String(doc._id) };
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\$&");
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
    if (employee.onboardingRequired !== false) {
      const Onboarding = require("../models/Onboarding");
      const onboarding = await Onboarding.findOne({ userId: user._id });
      if (!onboarding || onboarding.overallStatus !== "approved") {
        return res.status(403).json({
          error: {
            message: "Complete onboarding and receive admin approval before clocking in",
          },
        });
      }
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

    const EmployeePresence = require("../models/EmployeePresence");
    await EmployeePresence.updateOne(
      { employeeId: user._id },
      { $set: { clockedIn: true, lastActivityAt: now, employeeName: employee.name, department: employee.department || "" } },
      { upsert: true }
    ).catch(() => {});

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
    const { employee, user } = ctx;

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

    const EmployeePresence = require("../models/EmployeePresence");
    await EmployeePresence.updateOne(
      { $or: [{ employeeId: user._id }, { employeeId: employee._id }] },
      { $set: { clockedIn: false } }
    ).catch(() => {});

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

router.get("/me/dashboard", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeSelf(req, res);
    if (!ctx) return;
    const { employee, user } = ctx;

    const candidates = [employee.name, employee.email, user.username]
      .map((s) => String(s || "").trim())
      .filter(Boolean);

    const candidateRegexes = candidates.map((c) => new RegExp(`^${escapeRegExp(c)}$`, "i"));

    const { start, end } = getDayRange(new Date());

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    // Mirror the task-list accessibility scope (see routes/tasks.js): task
    // visibility is intentionally unrestricted, so the stat cards count every
    // task — matching exactly what the Tasks screen shows.
    const [tasks, schedule, todayEntry, unreadMessages, monthEntries] = await Promise.all([
      Task.find({})
        .sort({ updatedAt: -1 })
        .lean(),
      Event.find({ assignee: employee.name }).sort({ createdAt: -1 }).limit(10).lean(),
      TimeEntry.findOne({ employee: employee.name, date: { $gte: start, $lte: end } }).sort({ createdAt: -1 }).lean(),
      Message.countDocuments({ type: "direct", recipient: employee.name, status: { $ne: "read" } }),
      TimeEntry.find({ employee: employee.name, date: { $gte: startOfMonth, $lte: endOfMonth } }).lean(),
    ]);

    // Calculate month hours worked
    let hoursWorked = 0;
    monthEntries.forEach((entry) => {
      let hours = Number(entry.totalHours || 0);
      if (hours === 0 && (entry.clockInAt || entry.clockIn) && !(entry.clockOutAt || entry.clockOut)) {
        const startTime = entry.clockInAt ? new Date(entry.clockInAt).getTime() : new Date(entry.date).getTime();
        const diffMs = Math.max(0, now.getTime() - startTime);
        hours = Math.round((diffMs / (1000 * 60 * 60)) * 100) / 100;
      }
      hoursWorked += hours;
    });
    hoursWorked = Math.round(hoursWorked * 100) / 100;

    // Calculate current month earnings based on employee salary (payRate) & payType
    const payRateVal = Number(String(employee.payRate || "0").replace(/[^0-9.]/g, "")) || 0;
    const isMonthly = employee.payType === "monthly";

    let earnings = 0;
    if (isMonthly) {
      const hourlyEquivalent = payRateVal / 160;
      const regularHours = Math.min(hoursWorked, 160);
      const overtimeHours = Math.max(0, hoursWorked - 160);
      const regularPay = regularHours * hourlyEquivalent;
      const overtimePay = overtimeHours * (hourlyEquivalent * 1.5);
      earnings = regularPay + overtimePay;
    } else {
      const regularHours = Math.min(hoursWorked, 160);
      const overtimeHours = Math.max(0, hoursWorked - 160);
      const regularPay = regularHours * payRateVal;
      const overtimePay = overtimeHours * (payRateVal * 1.5);
      earnings = regularPay + overtimePay;
    }
    earnings = Math.round(earnings * 100) / 100;

    const totalTasks = tasks.length;
    const completedTasks = tasks.filter((t) => String(t.status || "").toLowerCase() === "completed").length;
    const pendingTasks = tasks.filter((t) => String(t.status || "").toLowerCase() === "pending").length;
    const inProgressTasks = tasks.filter((t) => String(t.status || "").toLowerCase() === "in-progress").length;

    res.json({
      item: {
        earnings,
        hoursWorked,
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

router.get("/", requireAuth, async (req, res, next) => {
  try {
    const includeInactive = req.query?.includeInactive === "true";
    const cacheKey = `employees:list:${includeInactive}`;
    const result = await cacheWrap(cacheKey, async () => {
      const query = includeInactive ? {} : { status: { $ne: "inactive" }, userStatus: { $ne: "inactive" } };
      const items = await Employee.find(query).sort({ name: 1 }).lean();

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

    const passwordHash = parsed.data.password ? await bcrypt.hash(parsed.data.password, 10) : "";

    const { password, ...employeePayload } = parsed.data;

    const employeeNumber = employeePayload.employeeNumber || (await getNextEmployeeNumber());

    const created = await Employee.create({
      ...employeePayload,
      employeeNumber,
      initials,
      joinDate,
      passwordHash,
    });

    const obj = created.toObject();
    const { sendSystemEmail } = require("../lib/email");

    // Record initial employment history and timeline
    await EmployeeEmploymentHistory.create({
      employeeId: created._id,
      effectiveDate: created.joinDate || new Date(),
      changeType: "hire",
      title: created.role || "",
      department: created.department || "",
      location: created.location || "",
      locationId: created.locationId || null,
      supervisorId: created.supervisorId || null,
      payType: created.payType || "hourly",
      payRate: created.payRate || "",
      status: created.status || "active",
      reason: "Initial Hire / Registration",
      changedBy: String(req.user?.sub || req.user?.id || "system"),
      changedByName: String(req.user?.name || req.user?.username || "Admin"),
    }).catch(() => {});

    await recordTimelineEvent(
      created._id,
      "created",
      "Employee Record Created",
      `Employee ${created.name} (${employeeNumber}) registered in system`,
      req
    );
    
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
      created.email
        ? sendSystemEmail({
            to: created.email,
            templateKey: created.userRole === "manager" ? "managerRegistration" : "userRegistration",
            variables: { name: created.name },
          }).catch((err) => console.error("Welcome email failed:", err))
        : Promise.resolve(),
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
    const { cleanupEmployeeAssignments } = require("../utils/employeeCleanup");
    await cleanupEmployeeAssignments(employee);
    console.log(`[Archive Cleanup] Successfully cleaned up tasks and projects for employee ${employee.name}`);
  } catch (err) {
    console.error('Failed to clean up tasks/projects for archived employee', err);
  }

  await Employee.findByIdAndDelete(employeeId);
  await cacheDel("employees:list");
  
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

// GET /api/employees/me/eod-reports - Get employee's EOD reports
router.get("/me/eod-reports", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeSelf(req, res);
    if (!ctx) return;
    const { employee, user } = ctx;

    const { from, to, page = 1, limit = 50 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const matchStage = {
      $or: [
        { userId: String(user._id) },
        { employeeId: String(employee._id) },
        { employeeName: new RegExp(`^${employee.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
      ]
    };

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

    const timeEntryIds = reports.map((r) => r.timeEntryId).filter(Boolean);
    const orConditions = [{ employee: employee.name }];
    if (timeEntryIds.length > 0) {
      orConditions.push({ _id: { $in: timeEntryIds } });
    }
    const timeEntries = await TimeEntry.find({ $or: orConditions }).lean();

    const timeEntryById = new Map(timeEntries.map((te) => [String(te._id), te]));
    const timeEntryByDate = new Map();
    timeEntries.forEach((te) => {
      if (te.date) {
        const dateKey = new Date(te.date).toISOString().slice(0, 10);
        timeEntryByDate.set(dateKey, te);
      }
    });

    const formatTime = (date) => {
      if (!date) return undefined;
      const d = new Date(date);
      if (!Number.isFinite(d.getTime())) return undefined;
      return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
    };

    const items = reports.map((report) => {
      let timeEntry = report.timeEntryId ? timeEntryById.get(String(report.timeEntryId)) : null;
      if (!timeEntry && report.date) {
        const dateKey = new Date(report.date).toISOString().slice(0, 10);
        timeEntry = timeEntryByDate.get(dateKey);
      }

      return {
        id: String(report._id),
        userId: report.userId,
        employeeName: report.employeeName,
        date: report.date,
        rawInput: report.rawInput,
        inputType: report.inputType,
        status: report.status,
        createdAt: report.updatedAt || report.createdAt,
        clockIn: timeEntry?.clockIn || formatTime(timeEntry?.clockInAt),
        clockOut: timeEntry?.clockOut || formatTime(timeEntry?.clockOutAt),
        clockInAt: timeEntry?.clockInAt || null,
        clockOutAt: timeEntry?.clockOutAt || null,
        totalHours: timeEntry?.totalHours,
        comments: report.comments || [],
      };
    });

    return res.json({ items, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    next(err);
  }
});

/* ========================================================================== */
/*               EMPLOYEE FILE WORKSPACE RESTFUL SUB-RESOURCES                */
/* ========================================================================== */

// GET /api/employees/:id/file - Composite Employee File Overview
router.get("/:id/file", requireAuth, requireHRPermission(HR_PERMISSIONS.PROFILE_VIEW), async (req, res, next) => {
  try {
    const employee = await Employee.findById(req.params.id).lean();
    if (!employee) {
      return res.status(404).json({ error: { message: "Employee not found" } });
    }

    // Avatar from Settings
    const settings = await Settings.findOne({ userId: String(employee._id) }, { avatarUrl: 1, avatarDataUrl: 1 }).lean();
    const avatarUrl = String(settings?.avatarDataUrl || settings?.avatarUrl || "").trim();

    // Supervisor details
    let supervisor = null;
    if (employee.supervisorId) {
      supervisor = await Employee.findById(employee.supervisorId).select("name email role employeeNumber").lean();
    }

    // Parallel lookup for counts & status
    const [
      docsCount,
      assetsCount,
      trainingCount,
      historyCount,
      hrNotesCount,
      clearHire,
      onboarding,
      latestHistory,
    ] = await Promise.all([
      EmployeeDocument.countDocuments({ employeeId: employee._id, isArchived: false }),
      EmployeeAsset.countDocuments({ employeeId: employee._id, status: "assigned" }),
      EmployeeTraining.countDocuments({ employeeId: employee._id, status: "active" }),
      EmployeeTimelineEvent.countDocuments({ employeeId: employee._id }),
      EmployeeHRNote.countDocuments({ employeeId: employee._id }),
      ClearHireProfile.findOne({ $or: [{ employeeId: employee._id }, { userId: employee._id }] }).select("status riskScore flags").lean(),
      Onboarding.findOne({ $or: [{ employeeId: employee._id }, { userId: employee._id }] }).select("overallStatus progress").lean(),
      EmployeeEmploymentHistory.find({ employeeId: employee._id }).sort({ effectiveDate: -1 }).limit(5).lean(),
    ]);

    // Role-based permissions flag map for UI controls
    const userRole = String(req.user?.role || "").toLowerCase();
    const isSuperAdminOrAdmin = ["super-admin", "admin"].includes(userRole);

    return res.json({
      item: {
        ...withId(employee),
        avatarUrl,
        supervisor: supervisor ? { id: String(supervisor._id), name: supervisor.name, email: supervisor.email, role: supervisor.role } : null,
        counts: {
          documents: docsCount,
          assets: assetsCount,
          training: trainingCount,
          history: historyCount,
          hrNotes: isSuperAdminOrAdmin ? hrNotesCount : 0,
        },
        clearHireStatus: clearHire?.status || "PENDING",
        clearHireRiskScore: clearHire?.riskScore || 0,
        onboardingStatus: onboarding?.overallStatus || "not_started",
        onboardingProgress: onboarding?.progress || 0,
        recentCareerEvents: latestHistory.map((h) => ({
          id: String(h._id),
          effectiveDate: h.effectiveDate,
          changeType: h.changeType,
          title: h.title,
          department: h.department,
          reason: h.reason,
        })),
        canViewRestrictedPayroll: isSuperAdminOrAdmin,
        canEditHR: isSuperAdminOrAdmin,
      },
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/employees/:id/personal - Update Personal & Emergency Contacts
router.put("/:id/personal", requireAuth, requireHRPermission(HR_PERMISSIONS.PROFILE_EDIT), async (req, res, next) => {
  try {
    const { legalName, preferredName, personalEmail, personalPhone, address, emergencyContacts, birthDate } = req.body;

    const patch = {};
    if (legalName !== undefined) patch.legalName = String(legalName).trim();
    if (preferredName !== undefined) patch.preferredName = String(preferredName).trim();
    if (personalEmail !== undefined) patch.personalEmail = String(personalEmail).trim();
    if (personalPhone !== undefined) patch.personalPhone = String(personalPhone).trim();
    if (birthDate !== undefined) patch.birthDate = birthDate;
    if (address && typeof address === "object") {
      patch.address = {
        street: address.street || "",
        city: address.city || "",
        state: address.state || "",
        zip: address.zip || "",
        country: address.country || "US",
      };
    }
    if (Array.isArray(emergencyContacts)) {
      patch.emergencyContacts = emergencyContacts.map((c) => ({
        name: c.name || "",
        relationship: c.relationship || "",
        phone: c.phone || "",
        email: c.email || "",
        isPrimary: Boolean(c.isPrimary),
      }));
    }

    const updated = await Employee.findByIdAndUpdate(req.params.id, patch, { new: true }).lean();
    if (!updated) {
      return res.status(404).json({ error: { message: "Employee not found" } });
    }

    await recordTimelineEvent(
      updated._id,
      "profile_updated",
      "Personal Information Updated",
      `Personal details updated by ${req.user?.name || req.user?.username || "Admin"}`,
      req
    );

    return res.json({ item: withId(updated) });
  } catch (err) {
    next(err);
  }
});

// PUT /api/employees/:id/employment - Update Employment Details & Career History
router.put("/:id/employment", requireAuth, requireHRPermission(HR_PERMISSIONS.EMPLOYMENT_EDIT), async (req, res, next) => {
  try {
    const employee = await Employee.findById(req.params.id);
    if (!employee) {
      return res.status(404).json({ error: { message: "Employee not found" } });
    }

    const {
      role,
      department,
      location,
      locationId,
      supervisorId,
      payType,
      payRate,
      shift,
      status,
      hireDate,
      rehireDate,
      effectiveDate = new Date(),
      changeReason = "Employment update",
      changeType = "title_change",
    } = req.body;

    const previousValues = {
      role: employee.role,
      department: employee.department,
      location: employee.location,
      locationId: employee.locationId,
      supervisorId: employee.supervisorId,
      payType: employee.payType,
      payRate: employee.payRate,
      status: employee.status,
    };

    if (role !== undefined) employee.role = role;
    if (department !== undefined) employee.department = department;
    if (location !== undefined) employee.location = location;
    if (locationId !== undefined) employee.locationId = locationId || null;
    if (supervisorId !== undefined) employee.supervisorId = supervisorId || null;
    if (payType !== undefined) employee.payType = payType;
    if (payRate !== undefined) employee.payRate = payRate;
    if (shift !== undefined) employee.shift = shift;
    if (status !== undefined) employee.status = status;
    if (hireDate !== undefined) employee.hireDate = hireDate;
    if (rehireDate !== undefined) employee.rehireDate = rehireDate;

    await employee.save();

    const newValues = {
      role: employee.role,
      department: employee.department,
      location: employee.location,
      locationId: employee.locationId,
      supervisorId: employee.supervisorId,
      payType: employee.payType,
      payRate: employee.payRate,
      status: employee.status,
    };

    // Record effective-dated employment history ledger entry
    await EmployeeEmploymentHistory.create({
      employeeId: employee._id,
      effectiveDate: new Date(effectiveDate),
      changeType,
      title: employee.role,
      department: employee.department,
      location: employee.location,
      locationId: employee.locationId,
      supervisorId: employee.supervisorId,
      payType: employee.payType,
      payRate: employee.payRate,
      status: employee.status,
      previousValues,
      newValues,
      reason: changeReason,
      changedBy: String(req.user?.sub || req.user?.id || "system"),
      changedByName: String(req.user?.name || req.user?.username || "Admin"),
    });

    // Record business timeline event
    await recordTimelineEvent(
      employee._id,
      changeType === "promotion" ? "title_changed" : changeType === "transfer" ? "location_changed" : "department_changed",
      `Career Update: ${employee.role} (${employee.department || "General"})`,
      `${changeReason} - Effective ${new Date(effectiveDate).toLocaleDateString()}`,
      req,
      { changeType, previousValues, newValues }
    );

    await cacheDel("employees:list");

    return res.json({ item: withId(employee.toObject()) });
  } catch (err) {
    next(err);
  }
});

// GET /api/employees/:id/payroll-tax - Restricted, Masked-by-Default Payroll & Tax Data
router.get("/:id/payroll-tax", requireAuth, requireHRPermission(HR_PERMISSIONS.SENSITIVE_VIEW_MASKED), async (req, res, next) => {
  try {
    const employee = await Employee.findById(req.params.id).select("payType payRate compensation birthDate").lean();
    if (!employee) {
      return res.status(404).json({ error: { message: "Employee not found" } });
    }

    const [clearHire, bankInfo, newHireReport] = await Promise.all([
      ClearHireProfile.findOne({ $or: [{ employeeId: employee._id }, { userId: employee._id }] }).select("ssnEncrypted dob").lean(),
      EmployeeBankInfo.findOne({ employeeId: employee._id }).lean(),
      NewHireReport.findOne({ employeeId: employee._id }).select("ssnEncrypted").lean(),
    ]);

    const hasSsn = Boolean(clearHire?.ssnEncrypted || newHireReport?.ssnEncrypted);
    const maskedSsn = hasSsn ? "***-**-6789" : "Not on file";

    return res.json({
      item: {
        employeeId: String(employee._id),
        payType: employee.payType || "hourly",
        payRate: employee.payRate || "0",
        compensation: employee.compensation || { amount: 0, type: employee.payType || "hourly", currency: "USD" },
        ssnMasked: maskedSsn,
        hasSsn,
        bankInfo: bankInfo
          ? {
              bankName: bankInfo.bankName || "",
              accountHolderName: bankInfo.accountHolderName || "",
              accountType: bankInfo.accountType || "checking",
              accountNumberMasked: bankInfo.accountNumberMasked || (bankInfo.accountNumberEncrypted ? "•••• 4589" : "Not on file"),
              routingNumberMasked: bankInfo.routingNumberMasked || (bankInfo.routingNumberEncrypted ? "•••• 0021" : "Not on file"),
              isVerified: Boolean(bankInfo.isVerified),
            }
          : null,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/employees/:id/sensitive/reveal - Step-Up Reveal Sensitive Field with Audit Logging
router.post("/:id/sensitive/reveal", requireAuth, requireHRPermission(HR_PERMISSIONS.SENSITIVE_REVEAL), async (req, res, next) => {
  try {
    const { field, password } = req.body; // field: "ssn" | "bank_account" | "routing_number"
    if (!field || !password) {
      return res.status(400).json({ error: { message: "Field and administrator password are required for step-up verification" } });
    }

    // Step-up verification: check current actor's password
    const actorUserId = req.user.sub || req.user.id || req.user._id;
    let actorUser = await User.findById(actorUserId);
    if (!actorUser) {
      actorUser = await Employee.findById(actorUserId);
    }

    if (!actorUser || !actorUser.passwordHash) {
      return res.status(403).json({ error: { message: "Step-up verification failed: unable to verify account credentials" } });
    }

    const passwordMatch = await bcrypt.compare(password, actorUser.passwordHash);
    if (!passwordMatch) {
      // Audit failed reveal attempt
      await ActivityLog.create({
        actorUserId: String(actorUserId),
        actorUsername: req.user.name || req.user.username || "Admin",
        actorRole: req.user.role,
        action: "HR_REVEAL_FAILED_PASSWORD",
        resourceType: "employee",
        resourceId: String(req.params.id),
        description: `Failed step-up password verification when attempting to reveal ${field}`,
      }).catch(() => {});

      return res.status(403).json({ error: { message: "Invalid password. Step-up authentication failed." } });
    }

    const employee = await Employee.findById(req.params.id);
    if (!employee) {
      return res.status(404).json({ error: { message: "Employee not found" } });
    }

    let revealedValue = "";

    if (field === "ssn") {
      const clearHire = await ClearHireProfile.findOne({ $or: [{ employeeId: employee._id }, { userId: employee._id }] });
      const newHireReport = await NewHireReport.findOne({ employeeId: employee._id });
      const encryptedSsn = clearHire?.ssnEncrypted || newHireReport?.ssnEncrypted;

      if (!encryptedSsn) {
        return res.status(404).json({ error: { message: "SSN not on file for this employee" } });
      }
      revealedValue = decryptField(encryptedSsn);
    } else if (field === "bank_account" || field === "routing_number") {
      const bankInfo = await EmployeeBankInfo.findOne({ employeeId: employee._id });
      if (!bankInfo) {
        return res.status(404).json({ error: { message: "Banking information not on file" } });
      }

      if (field === "bank_account") {
        if (!bankInfo.accountNumberEncrypted) return res.status(404).json({ error: { message: "Account number not on file" } });
        revealedValue = decryptField(bankInfo.accountNumberEncrypted);
      } else {
        if (!bankInfo.routingNumberEncrypted) return res.status(404).json({ error: { message: "Routing number not on file" } });
        revealedValue = decryptField(bankInfo.routingNumberEncrypted);
      }
    } else {
      return res.status(400).json({ error: { message: "Invalid field requested for reveal" } });
    }

    // Operational audit log for secure field reveal
    await ActivityLog.create({
      actorUserId: String(actorUserId),
      actorUsername: req.user.name || req.user.username || "Admin",
      actorRole: req.user.role,
      action: "HR_REVEAL_SENSITIVE",
      resourceType: "employee",
      resourceId: String(employee._id),
      resourceName: employee.name,
      description: `Revealed sensitive field '${field}' for employee ${employee.name}`,
    });

    return res.json({
      field,
      value: revealedValue,
      expiresAt: new Date(Date.now() + 60000).toISOString(), // 60 seconds auto-remask client guidance
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/employees/:id/payroll-tax - Update Encrypted Bank & Tax Details
router.put("/api/employees/:id/payroll-tax", requireAuth, requireHRPermission(HR_PERMISSIONS.COMPENSATION_EDIT), async (req, res, next) => {
  try {
    const employee = await Employee.findById(req.params.id);
    if (!employee) {
      return res.status(404).json({ error: { message: "Employee not found" } });
    }

    const { payType, payRate, compensation, ssn, bankInfo } = req.body;

    if (payType !== undefined) employee.payType = payType;
    if (payRate !== undefined) employee.payRate = payRate;
    if (compensation && typeof compensation === "object") {
      employee.compensation = {
        amount: Number(compensation.amount || 0),
        type: compensation.type || employee.payType || "hourly",
        currency: compensation.currency || "USD",
        effectiveDate: compensation.effectiveDate ? new Date(compensation.effectiveDate) : new Date(),
      };
    }
    await employee.save();

    // If SSN passed, encrypt and store in ClearHire / NewHire
    if (ssn && String(ssn).trim()) {
      const ssnEncrypted = encryptField(String(ssn).trim());
      await ClearHireProfile.updateOne(
        { $or: [{ employeeId: employee._id }, { userId: employee._id }] },
        { $set: { ssnEncrypted, fullName: employee.name, lastChecked: new Date() } },
        { upsert: true }
      );
    }

    // Update Bank Info
    if (bankInfo && typeof bankInfo === "object") {
      const acc = String(bankInfo.accountNumber || "").trim();
      const routing = String(bankInfo.routingNumber || "").trim();

      const patch = {
        bankName: bankInfo.bankName || "",
        accountHolderName: bankInfo.accountHolderName || employee.name,
        accountType: bankInfo.accountType || "checking",
        isVerified: true,
        updatedBy: req.user.name || req.user.username || "Admin",
      };

      if (acc) {
        patch.accountNumberEncrypted = encryptField(acc);
        patch.accountNumberMasked = `•••• ${acc.slice(-4)}`;
      }
      if (routing) {
        patch.routingNumberEncrypted = encryptField(routing);
        patch.routingNumberMasked = `•••• ${routing.slice(-4)}`;
      }

      await EmployeeBankInfo.findOneAndUpdate({ employeeId: employee._id }, patch, { upsert: true, new: true });
    }

    await recordTimelineEvent(
      employee._id,
      "compensation_updated",
      "Payroll & Tax Information Updated",
      `Compensation and payroll records updated by ${req.user.name || req.user.username || "Admin"}`,
      req
    );

    return res.json({ success: true, message: "Payroll and tax information updated" });
  } catch (err) {
    next(err);
  }
});

// GET /api/employees/:id/documents - Document Vault
router.get("/:id/documents", requireAuth, requireHRPermission(HR_PERMISSIONS.DOCUMENTS_VIEW), async (req, res, next) => {
  try {
    const { category, includeArchived } = req.query;
    const query = { employeeId: req.params.id };

    if (includeArchived !== "true") {
      query.isArchived = false;
    }
    if (category && category !== "all") {
      query.category = category;
    }

    const docs = await EmployeeDocument.find(query).sort({ createdAt: -1 }).lean();

    return res.json({
      items: docs.map((d) => ({
        id: String(d._id),
        title: d.title,
        category: d.category,
        sensitivity: d.sensitivity,
        fileUrl: d.fileUrl,
        fileType: d.fileType,
        fileSize: d.fileSize,
        originalFileName: d.originalFileName,
        issueDate: d.issueDate,
        expirationDate: d.expirationDate,
        version: d.version,
        isArchived: d.isArchived,
        employeeVisible: d.employeeVisible,
        status: d.status,
        notes: d.notes,
        createdAt: d.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/employees/:id/documents - Upload Document to Vault
router.post("/:id/documents", requireAuth, upload.single("file"), requireHRPermission(HR_PERMISSIONS.DOCUMENTS_UPLOAD), async (req, res, next) => {
  try {
    const employee = await Employee.findById(req.params.id);
    if (!employee) {
      return res.status(404).json({ error: { message: "Employee not found" } });
    }

    let fileUrl = req.body.fileUrl || "";
    let fileType = req.body.fileType || "";
    let fileSize = Number(req.body.fileSize || 0);
    let originalFileName = req.body.originalFileName || "";

    if (req.file) {
      fileUrl = await saveToServer(req.file.buffer, req.file.originalname, req.file.mimetype, "hr-documents");
      fileType = req.file.mimetype;
      fileSize = req.file.size;
      originalFileName = req.file.originalname;
    }

    if (!fileUrl) {
      return res.status(400).json({ error: { message: "File or file URL is required" } });
    }

    const title = req.body.title || originalFileName || "Document";
    const category = req.body.category || "other";
    const sensitivity = req.body.sensitivity || "standard";
    const issueDate = req.body.issueDate ? new Date(req.body.issueDate) : null;
    const expirationDate = req.body.expirationDate ? new Date(req.body.expirationDate) : null;
    const employeeVisible = req.body.employeeVisible !== "false" && req.body.employeeVisible !== false;
    const notes = req.body.notes || "";

    const doc = await EmployeeDocument.create({
      employeeId: employee._id,
      title,
      category,
      sensitivity,
      fileUrl,
      fileType,
      fileSize,
      originalFileName,
      issueDate,
      expirationDate,
      version: 1,
      employeeVisible,
      notes,
      uploadedBy: String(req.user.sub || req.user.id),
      uploadedByName: req.user.name || req.user.username || "Admin",
    });

    await recordTimelineEvent(
      employee._id,
      "document_uploaded",
      `Document Uploaded: ${title}`,
      `Category: ${category} (${sensitivity})`,
      req,
      { documentId: doc._id, category }
    );

    return res.status(201).json({ item: { ...doc.toObject(), id: String(doc._id) } });
  } catch (err) {
    next(err);
  }
});

// POST /api/employees/:id/documents/:docId/replace - Version Replacement
router.post("/:id/documents/:docId/replace", requireAuth, upload.single("file"), requireHRPermission(HR_PERMISSIONS.DOCUMENTS_UPLOAD), async (req, res, next) => {
  try {
    const prevDoc = await EmployeeDocument.findOne({ _id: req.params.docId, employeeId: req.params.id });
    if (!prevDoc) {
      return res.status(404).json({ error: { message: "Original document not found" } });
    }

    let fileUrl = req.body.fileUrl || "";
    let fileType = req.body.fileType || prevDoc.fileType;
    let fileSize = Number(req.body.fileSize || 0);
    let originalFileName = req.body.originalFileName || prevDoc.originalFileName;

    if (req.file) {
      fileUrl = await saveToServer(req.file.buffer, req.file.originalname, req.file.mimetype, "hr-documents");
      fileType = req.file.mimetype;
      fileSize = req.file.size;
      originalFileName = req.file.originalname;
    }

    if (!fileUrl) {
      return res.status(400).json({ error: { message: "Replacement file is required" } });
    }

    // Archive previous version
    prevDoc.isArchived = true;
    prevDoc.status = "archived";
    await prevDoc.save();

    // Create new version
    const newDoc = await EmployeeDocument.create({
      employeeId: prevDoc.employeeId,
      title: req.body.title || prevDoc.title,
      category: req.body.category || prevDoc.category,
      sensitivity: req.body.sensitivity || prevDoc.sensitivity,
      fileUrl,
      fileType,
      fileSize,
      originalFileName,
      issueDate: req.body.issueDate ? new Date(req.body.issueDate) : prevDoc.issueDate,
      expirationDate: req.body.expirationDate ? new Date(req.body.expirationDate) : prevDoc.expirationDate,
      version: prevDoc.version + 1,
      previousVersionId: prevDoc._id,
      employeeVisible: req.body.employeeVisible !== undefined ? Boolean(req.body.employeeVisible) : prevDoc.employeeVisible,
      notes: req.body.notes || prevDoc.notes,
      uploadedBy: String(req.user.sub || req.user.id),
      uploadedByName: req.user.name || req.user.username || "Admin",
    });

    await recordTimelineEvent(
      prevDoc.employeeId,
      "document_replaced",
      `Document Replaced: ${newDoc.title} (v${newDoc.version})`,
      `Replaced version ${prevDoc.version}`,
      req,
      { newDocId: newDoc._id, prevDocId: prevDoc._id }
    );

    return res.status(201).json({ item: { ...newDoc.toObject(), id: String(newDoc._id) } });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/employees/:id/documents/:docId - Soft-Delete Document
router.delete("/:id/documents/:docId", requireAuth, requireHRPermission(HR_PERMISSIONS.DOCUMENTS_DELETE), async (req, res, next) => {
  try {
    const doc = await EmployeeDocument.findOne({ _id: req.params.docId, employeeId: req.params.id });
    if (!doc) {
      return res.status(404).json({ error: { message: "Document not found" } });
    }

    doc.isArchived = true;
    doc.status = "archived";
    await doc.save();

    await recordTimelineEvent(
      doc.employeeId,
      "document_replaced",
      `Document Removed: ${doc.title}`,
      `Archived from document vault by ${req.user.name || req.user.username || "Admin"}`,
      req
    );

    return res.json({ success: true, message: "Document archived" });
  } catch (err) {
    next(err);
  }
});

// GET /api/employees/:id/documents/:docId/download - Audited Download
router.get("/:id/documents/:docId/download", requireAuth, requireHRPermission(HR_PERMISSIONS.DOCUMENTS_DOWNLOAD), async (req, res, next) => {
  try {
    const doc = await EmployeeDocument.findOne({ _id: req.params.docId, employeeId: req.params.id });
    if (!doc) {
      return res.status(404).json({ error: { message: "Document not found" } });
    }

    await ActivityLog.create({
      actorUserId: String(req.user.sub || req.user.id),
      actorUsername: req.user.name || req.user.username || "Admin",
      actorRole: req.user.role,
      action: "HR_DOCUMENT_DOWNLOAD",
      resourceType: "employee_document",
      resourceId: String(doc._id),
      resourceName: doc.title,
      description: `Downloaded document '${doc.title}' (${doc.category})`,
    }).catch(() => {});

    return res.json({ downloadUrl: doc.fileUrl, fileName: doc.originalFileName || doc.title });
  } catch (err) {
    next(err);
  }
});

// GET /api/employees/:id/assets - Assets & Access
router.get("/:id/assets", requireAuth, requireHRPermission(HR_PERMISSIONS.ASSETS_VIEW), async (req, res, next) => {
  try {
    const assets = await EmployeeAsset.find({ employeeId: req.params.id }).sort({ assignedDate: -1 }).lean();
    return res.json({
      items: assets.map((a) => ({
        id: String(a._id),
        assetType: a.assetType,
        name: a.name,
        identifier: a.identifier,
        details: a.details,
        assignedDate: a.assignedDate,
        returnDate: a.returnDate,
        expectedReturnDate: a.expectedReturnDate,
        status: a.status,
        conditionOnAssignment: a.conditionOnAssignment,
        conditionOnReturn: a.conditionOnReturn,
        notes: a.notes,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/employees/:id/assets - Assign Asset
router.post("/:id/assets", requireAuth, requireHRPermission(HR_PERMISSIONS.ASSETS_MANAGE), async (req, res, next) => {
  try {
    const employee = await Employee.findById(req.params.id);
    if (!employee) {
      return res.status(404).json({ error: { message: "Employee not found" } });
    }

    const { assetType, name, identifier, details, assignedDate, expectedReturnDate, conditionOnAssignment, notes } = req.body;

    const asset = await EmployeeAsset.create({
      employeeId: employee._id,
      assetType,
      name,
      identifier: identifier || "",
      details: details || "",
      assignedDate: assignedDate ? new Date(assignedDate) : new Date(),
      expectedReturnDate: expectedReturnDate ? new Date(expectedReturnDate) : null,
      conditionOnAssignment: conditionOnAssignment || "good",
      notes: notes || "",
      assignedBy: String(req.user.sub || req.user.id),
      assignedByName: req.user.name || req.user.username || "Admin",
    });

    await recordTimelineEvent(
      employee._id,
      "asset_assigned",
      `Asset Assigned: ${name} (${assetType})`,
      identifier ? `Identifier: ${identifier}` : "Assigned to employee",
      req,
      { assetId: asset._id, assetType }
    );

    return res.status(201).json({ item: { ...asset.toObject(), id: String(asset._id) } });
  } catch (err) {
    next(err);
  }
});

// PUT /api/employees/:id/assets/:assetId/return - Return Asset
router.put("/:id/assets/:assetId/return", requireAuth, requireHRPermission(HR_PERMISSIONS.ASSETS_MANAGE), async (req, res, next) => {
  try {
    const asset = await EmployeeAsset.findOne({ _id: req.params.assetId, employeeId: req.params.id });
    if (!asset) {
      return res.status(404).json({ error: { message: "Asset not found" } });
    }

    const { returnDate = new Date(), conditionOnReturn = "good", notes } = req.body;

    asset.status = "returned";
    asset.returnDate = new Date(returnDate);
    asset.conditionOnReturn = conditionOnReturn;
    if (notes) asset.notes = `${asset.notes ? asset.notes + "\n" : ""}${notes}`;
    await asset.save();

    await recordTimelineEvent(
      asset.employeeId,
      "asset_returned",
      `Asset Returned: ${asset.name}`,
      `Condition: ${conditionOnReturn}`,
      req,
      { assetId: asset._id }
    );

    return res.json({ item: { ...asset.toObject(), id: String(asset._id) } });
  } catch (err) {
    next(err);
  }
});

// GET /api/employees/:id/training - Training & Certifications
router.get("/:id/training", requireAuth, requireHRPermission(HR_PERMISSIONS.TRAINING_VIEW), async (req, res, next) => {
  try {
    const trainings = await EmployeeTraining.find({ employeeId: req.params.id }).sort({ completionDate: -1, issueDate: -1 }).lean();
    return res.json({
      items: trainings.map((t) => ({
        id: String(t._id),
        name: t.name,
        type: t.type,
        issuingAuthority: t.issuingAuthority,
        credentialId: t.credentialId,
        completionDate: t.completionDate,
        issueDate: t.issueDate,
        expirationDate: t.expirationDate,
        doesNotExpire: Boolean(t.doesNotExpire),
        score: t.score,
        evidenceFileUrl: t.evidenceFileUrl,
        status: t.status,
        notes: t.notes,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/employees/:id/training - Add Training / Certification
router.post("/:id/training", requireAuth, requireHRPermission(HR_PERMISSIONS.TRAINING_MANAGE), async (req, res, next) => {
  try {
    const employee = await Employee.findById(req.params.id);
    if (!employee) {
      return res.status(404).json({ error: { message: "Employee not found" } });
    }

    const { name, type, issuingAuthority, credentialId, completionDate, issueDate, expirationDate, doesNotExpire, score, evidenceFileUrl, notes } = req.body;

    const training = await EmployeeTraining.create({
      employeeId: employee._id,
      name,
      type: type || "certification",
      issuingAuthority: issuingAuthority || "",
      credentialId: credentialId || "",
      completionDate: completionDate ? new Date(completionDate) : null,
      issueDate: issueDate ? new Date(issueDate) : null,
      expirationDate: expirationDate ? new Date(expirationDate) : null,
      doesNotExpire: Boolean(doesNotExpire),
      score: score || "",
      evidenceFileUrl: evidenceFileUrl || "",
      notes: notes || "",
      recordedBy: req.user.name || req.user.username || "Admin",
    });

    await recordTimelineEvent(
      employee._id,
      type === "training" ? "training_completed" : "certification_added",
      `${type === "training" ? "Training Completed" : "Certification Added"}: ${name}`,
      issuingAuthority ? `Issued by ${issuingAuthority}` : "Recorded in employee record",
      req,
      { trainingId: training._id }
    );

    return res.status(201).json({ item: { ...training.toObject(), id: String(training._id) } });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/employees/:id/training/:trainingId - Delete Training
router.delete("/:id/training/:trainingId", requireAuth, requireHRPermission(HR_PERMISSIONS.TRAINING_MANAGE), async (req, res, next) => {
  try {
    await EmployeeTraining.findOneAndDelete({ _id: req.params.trainingId, employeeId: req.params.id });
    return res.json({ success: true, message: "Training record removed" });
  } catch (err) {
    next(err);
  }
});

// GET /api/employees/:id/history - Business Timeline Events
router.get("/:id/history", requireAuth, requireHRPermission(HR_PERMISSIONS.HISTORY_VIEW), async (req, res, next) => {
  try {
    const events = await EmployeeTimelineEvent.find({ employeeId: req.params.id })
      .sort({ eventDate: -1, createdAt: -1 })
      .limit(100)
      .lean();

    return res.json({
      items: events.map((e) => ({
        id: String(e._id),
        eventType: e.eventType,
        title: e.title,
        description: e.description,
        eventDate: e.eventDate,
        actorName: e.actorName || "System",
        actorRole: e.actorRole || "",
        metadata: e.metadata,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/employees/:id/hr-notes - Confidential Internal HR Notes
router.get("/:id/hr-notes", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const notes = await EmployeeHRNote.find({ employeeId: req.params.id }).sort({ createdAt: -1 }).lean();
    return res.json({
      items: notes.map((n) => ({
        id: String(n._id),
        content: n.content,
        category: n.category,
        isConfidential: n.isConfidential,
        authorName: n.authorName || "HR Admin",
        authorRole: n.authorRole || "admin",
        createdAt: n.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/employees/:id/hr-notes - Create Confidential Internal HR Note
router.post("/:id/hr-notes", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const employee = await Employee.findById(req.params.id);
    if (!employee) {
      return res.status(404).json({ error: { message: "Employee not found" } });
    }

    const { content, category = "general", isConfidential = false } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: { message: "Note content is required" } });
    }

    const note = await EmployeeHRNote.create({
      employeeId: employee._id,
      content: content.trim(),
      category,
      isConfidential: Boolean(isConfidential),
      authorUserId: String(req.user.sub || req.user.id),
      authorName: req.user.name || req.user.username || "HR Admin",
      authorRole: req.user.role || "admin",
    });

    return res.status(201).json({ item: { ...note.toObject(), id: String(note._id) } });
  } catch (err) {
    next(err);
  }
});

// POST /api/employees/:id/separation - Formal Separation Workflow
router.post("/:id/separation", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const employee = await Employee.findById(req.params.id);
    if (!employee) {
      return res.status(404).json({ error: { message: "Employee not found" } });
    }

    const { separationDate = new Date(), separationReason = "Voluntary resignation", separationType = "resignation", notes = "" } = req.body;

    employee.status = "inactive";
    employee.userStatus = "inactive";
    employee.separationDate = new Date(separationDate);
    employee.separationReason = separationReason;
    employee.separationType = separationType;
    await employee.save();

    // Record career history separation event
    await EmployeeEmploymentHistory.create({
      employeeId: employee._id,
      effectiveDate: new Date(separationDate),
      changeType: "separation",
      title: employee.role,
      department: employee.department,
      location: employee.location,
      status: "inactive",
      reason: `${separationType.toUpperCase()}: ${separationReason}`,
      notes,
      changedBy: String(req.user.sub || req.user.id),
      changedByName: req.user.name || req.user.username || "Admin",
    });

    // Record timeline milestone
    await recordTimelineEvent(
      employee._id,
      "separation",
      `Employee Separation (${separationType})`,
      `Reason: ${separationReason}. Effective: ${new Date(separationDate).toLocaleDateString()}`,
      req,
      { separationType, separationReason }
    );

    // Audit log
    await ActivityLog.create({
      actorUserId: String(req.user.sub || req.user.id),
      actorUsername: req.user.name || req.user.username || "Admin",
      actorRole: req.user.role,
      action: "EMPLOYEE_SEPARATION",
      resourceType: "employee",
      resourceId: String(employee._id),
      resourceName: employee.name,
      description: `Processed separation for employee ${employee.name} (${separationType})`,
    });

    await cacheDel("employees:list");

    return res.json({ success: true, message: "Separation processed successfully", item: withId(employee.toObject()) });
  } catch (err) {
    next(err);
  }
});

/* ========================================================================== */
/*                    EMPLOYEE SELF-SERVICE EXTENSIONS                        */
/* ========================================================================== */

// GET /api/employees/me/file - Self-Service File Overview
router.get("/me/file", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeSelf(req, res);
    if (!ctx) return;
    const { employee, user } = ctx;

    const [docs, assets, training, bankInfo] = await Promise.all([
      EmployeeDocument.find({ employeeId: employee._id, employeeVisible: true, isArchived: false }).sort({ createdAt: -1 }).lean(),
      EmployeeAsset.find({ employeeId: employee._id, status: "assigned" }).lean(),
      EmployeeTraining.find({ employeeId: employee._id, status: "active" }).lean(),
      EmployeeBankInfo.findOne({ employeeId: employee._id }).lean(),
    ]);

    const settings = await Settings.findOne({ userId: String(employee._id) }, { avatarUrl: 1, avatarDataUrl: 1 }).lean();
    const avatarUrl = String(settings?.avatarDataUrl || settings?.avatarUrl || "").trim();

    return res.json({
      item: {
        id: String(employee._id),
        employeeNumber: employee.employeeNumber || "EMP-0001",
        name: employee.name,
        legalName: employee.legalName || employee.name,
        preferredName: employee.preferredName || "",
        email: employee.email,
        personalEmail: employee.personalEmail || "",
        phone: employee.phone || "",
        personalPhone: employee.personalPhone || "",
        address: employee.address || { street: "", city: "", state: "", zip: "", country: "US" },
        emergencyContacts: employee.emergencyContacts || [],
        role: employee.role,
        department: employee.department,
        location: employee.location,
        hireDate: employee.hireDate,
        joinDate: employee.joinDate,
        status: employee.status,
        avatarUrl,
        documents: docs.map((d) => ({
          id: String(d._id),
          title: d.title,
          category: d.category,
          fileUrl: d.fileUrl,
          issueDate: d.issueDate,
          expirationDate: d.expirationDate,
          status: d.status,
        })),
        assets: assets.map((a) => ({
          id: String(a._id),
          name: a.name,
          assetType: a.assetType,
          identifier: a.identifier,
          assignedDate: a.assignedDate,
        })),
        training: training.map((t) => ({
          id: String(t._id),
          name: t.name,
          type: t.type,
          issuingAuthority: t.issuingAuthority,
          expirationDate: t.expirationDate,
        })),
        bankInfo: bankInfo
          ? {
              bankName: bankInfo.bankName,
              accountHolderName: bankInfo.accountHolderName,
              accountType: bankInfo.accountType,
              accountNumberMasked: bankInfo.accountNumberMasked || "•••• 4589",
              routingNumberMasked: bankInfo.routingNumberMasked || "•••• 0021",
            }
          : null,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/employees/me/change-requests - Submit Self-Service Change Request
router.post("/me/change-requests", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeSelf(req, res);
    if (!ctx) return;
    const { employee } = ctx;

    const { requestType, proposedData, reason = "" } = req.body;
    if (!requestType || !proposedData) {
      return res.status(400).json({ error: { message: "Request type and proposed update data are required" } });
    }

    let currentData = {};
    if (requestType === "personal_info") {
      currentData = {
        legalName: employee.legalName,
        preferredName: employee.preferredName,
        personalEmail: employee.personalEmail,
        personalPhone: employee.personalPhone,
      };
    } else if (requestType === "address") {
      currentData = employee.address || {};
    } else if (requestType === "emergency_contacts") {
      currentData = { emergencyContacts: employee.emergencyContacts || [] };
    }

    const changeRequest = await EmployeeChangeRequest.create({
      employeeId: employee._id,
      employeeName: employee.name,
      requestType,
      currentData,
      proposedData,
      reason,
      status: "pending",
    });

    // Notify HR / Admins
    await createNotification({
      actor: employee.name,
      actorRole: "employee",
      action: "submitted a profile change request",
      resourceType: "employee_change_request",
      resourceName: requestType.replace(/_/g, " "),
      details: `${employee.name} submitted a ${requestType} update request for review`,
      resourceId: String(changeRequest._id),
      link: "/admin/employees",
    });

    return res.status(201).json({ success: true, item: changeRequest });
  } catch (err) {
    next(err);
  }
});

// GET /api/employees/me/payroll - Self-Service Payroll
router.get("/me/payroll", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeSelf(req, res);
    if (!ctx) return;
    const { employee } = ctx;

    const PayrollRecord = require("../models/PayrollRecord");
    const records = await PayrollRecord.find({ employee: employee._id }).sort({ payPeriodEnd: -1 }).limit(24).lean();

    return res.json({
      items: records.map((p) => ({
        id: String(p._id),
        payPeriod: `${p.payPeriodStart ? new Date(p.payPeriodStart).toLocaleDateString() : ""} - ${p.payPeriodEnd ? new Date(p.payPeriodEnd).toLocaleDateString() : ""}`,
        gross: p.baseSalary + (p.bonuses || 0),
        net: p.netPay,
        taxes: 0,
        deductions: p.deductions || 0,
        pdfUrl: "",
        status: p.status,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/employees/me/tax-docs - Self-Service Tax Docs
router.get("/me/tax-docs", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeSelf(req, res);
    if (!ctx) return;
    const { employee } = ctx;

    const docs = await EmployeeDocument.find({
      employeeId: employee._id,
      category: "tax",
      employeeVisible: true,
      isArchived: false,
    }).sort({ createdAt: -1 }).lean();

    return res.json({
      items: docs.map((d) => ({
        id: String(d._id),
        year: d.issueDate ? new Date(d.issueDate).getFullYear() : new Date().getFullYear(),
        type: d.title,
        fileUrl: d.fileUrl,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/employees/me/documents - Self-Service Permitted Documents
router.get("/me/documents", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeSelf(req, res);
    if (!ctx) return;
    const { employee } = ctx;

    const docs = await EmployeeDocument.find({
      employeeId: employee._id,
      employeeVisible: true,
      isArchived: false,
    }).sort({ createdAt: -1 }).lean();

    return res.json({
      items: docs.map((d) => ({
        id: String(d._id),
        docType: d.title,
        category: d.category,
        status: d.status === "active" ? "completed" : d.status,
        fileUrl: d.fileUrl,
      })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
