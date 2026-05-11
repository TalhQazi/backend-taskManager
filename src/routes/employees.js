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
const PayrollRecord = require("../models/PayrollRecord");
const TaxDocument = require("../models/TaxDocument");
const Document = require("../models/Document");
const TimeLog = require("../models/TimeLog");
const { createNotification } = require("../utils/notifications");
const { requireAuth, requireRole } = require("../middleware/auth");
const { parsePagination, paginatedResponse } = require("../lib/pagination");
const { cacheWrap, cacheDel } = require("../lib/cache");
const { logAudit, AUDIT_ACTIONS } = require("../lib/auditLogger");
const { getPresignedUrl } = require("../lib/s3Service");

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
  const role = String(req.user?.role || "").trim();
  if (role !== "employee" && role !== "manager") {
    res.status(403).json({ error: { message: "Forbidden" } });
    return null;
  }

  const userId = String(req.user?.sub || "").trim();
  if (!userId) {
    res.status(401).json({ error: { message: "Unauthorized" } });
    return null;
  }

  const employee = await Employee.findById(userId, { passwordHash: 0 }).lean();
  if (!employee) {
    res.status(401).json({ error: { message: "Employee profile not found" } });
    return null;
  }

  return { user: { _id: userId, ...employee }, employee };
}

// Get employee with Mongoose document (for update operations)
async function requireEmployeeSelfDoc(req, res) {
  const role = String(req.user?.role || "").trim();
  if (role !== "employee" && role !== "manager") {
    res.status(403).json({ error: { message: "Forbidden" } });
    return null;
  }

  const userId = String(req.user?.sub || "").trim();
  if (!userId) {
    res.status(401).json({ error: { message: "Unauthorized" } });
    return null;
  }

  const employee = await Employee.findById(userId);
  if (!employee) {
    res.status(401).json({ error: { message: "Employee profile not found" } });
    return null;
  }

  return { user: { _id: userId }, employee };
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
        username: employee.email || "",
        role: "employee",
        payType: employee.payType || "hourly",
        payRate: employee.payRate || "0",
        emergencyContactName: employee.emergencyContactName || "",
        emergencyContactPhone: employee.emergencyContactPhone || "",
        emergencyContactRelation: employee.emergencyContactRelation || "",
        filingStatus: employee.filingStatus || "",
        allowances: employee.allowances || 0,
        additionalWithholding: employee.additionalWithholding || 0,
        mfaEnabled: employee.mfaEnabled || false,
      },
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/employees/me/profile/bank - Update bank info
router.put("/me/profile/bank", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeSelfDoc(req, res);
    if (!ctx) return;
    const { employee } = ctx;

    const { bankInfo } = req.body;
    if (!bankInfo) {
      return res.status(400).json({ error: { message: "Bank info is required" } });
    }

    employee.bankInfo = bankInfo;
    await employee.save();

    await logAudit(req, AUDIT_ACTIONS.PROFILE_UPDATE);

    res.json({ success: true, bankInfo: employee.bankInfo });
  } catch (err) {
    next(err);
  }
});

// PUT /api/employees/me/profile/tax - Update tax withholding settings
router.put("/me/profile/tax", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeSelfDoc(req, res);
    if (!ctx) return;
    const { employee } = ctx;

    const { filingStatus, allowances, additionalWithholding } = req.body;

    if (filingStatus !== undefined) employee.filingStatus = filingStatus;
    if (allowances !== undefined) employee.allowances = Number(allowances);
    if (additionalWithholding !== undefined) employee.additionalWithholding = Number(additionalWithholding);

    await employee.save();

    await logAudit(req, AUDIT_ACTIONS.PROFILE_UPDATE);

    res.json({ 
      success: true, 
      taxSettings: {
        filingStatus: employee.filingStatus,
        allowances: employee.allowances,
        additionalWithholding: employee.additionalWithholding,
      }
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

router.get("/me/schedule", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeSelf(req, res);
    if (!ctx) return;
    const { employee } = ctx;

    const assigneeName = employee?.name || "";
    const items = assigneeName 
      ? await Event.find({ assignee: assigneeName }).sort({ createdAt: -1 }).lean()
      : [];

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
        actor: req.user?.username || req.user?.name || "Admin",
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
          actor: req.user?.username || req.user?.name || "Admin",
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
      actor: req.user?.username || req.user?.name || "Admin",
      actorRole: req.user?.role || "admin",
      action: "updated",
      resourceType: "employee",
      resourceName: updated.name,
      resourceId: String(req.params.id),
    });

    return res.json({ item: withId(updated) });
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
      actor: req.user?.username || req.user?.name || "Admin",
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
      createdAt: report.createdAt,
    }));

    return res.json({ items, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    next(err);
  }
});

// GET /api/employees/me/payroll - Get employee's payroll records
router.get("/me/payroll", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeSelf(req, res);
    if (!ctx) return;
    const { user } = ctx;

    await logAudit(req, AUDIT_ACTIONS.PAYROLL_VIEW);

    const { page = 1, limit = 50, year } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const filter = { employee_id: String(user._id) };
    if (year) {
      filter.pay_period = { $regex: year };
    }

    const [records, total] = await Promise.all([
      PayrollRecord.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      PayrollRecord.countDocuments(filter)
    ]);

    const items = records.map(r => ({
      id: String(r._id),
      employeeId: String(r.employee_id),
      payPeriod: r.pay_period,
      gross: r.gross,
      net: r.net,
      taxes: r.taxes,
      deductions: r.deductions,
      pdfUrl: r.pdf_url,
      createdAt: r.createdAt,
    }));

    return res.json({ items, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    next(err);
  }
});

// GET /api/employees/me/tax-docs - Get employee's tax documents
router.get("/me/tax-docs", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeSelf(req, res);
    if (!ctx) return;
    const { user } = ctx;

    await logAudit(req, AUDIT_ACTIONS.TAX_DOC_VIEW);

    const { year, type, page = 1, limit = 50 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const filter = { employee_id: String(user._id) };
    if (year) filter.year = Number(year);
    if (type) filter.type = type;

    const [docs, total] = await Promise.all([
      TaxDocument.find(filter)
        .sort({ year: -1, type: 1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      TaxDocument.countDocuments(filter)
    ]);

    const items = docs.map(d => ({
      id: String(d._id),
      employeeId: String(d.employee_id),
      year: d.year,
      type: d.type,
      fileUrl: d.file_url,
      createdAt: d.createdAt,
    }));

    return res.json({ items, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    next(err);
  }
});

// GET /api/employees/me/tax-docs/years - Get available tax years
router.get("/me/tax-docs/years", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeSelf(req, res);
    if (!ctx) return;
    const { user } = ctx;

    const years = await TaxDocument.distinct("year", { employee_id: String(user._id) });
    return res.json({ years: years.sort((a, b) => b - a) });
  } catch (err) {
    next(err);
  }
});

// GET /api/employees/me/documents - Get employee's documents
router.get("/me/documents", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeSelf(req, res);
    if (!ctx) return;
    const { user } = ctx;

    await logAudit(req, AUDIT_ACTIONS.DOCUMENT_VIEW);

    const { docType, status, page = 1, limit = 50 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const filter = { employee_id: String(user._id) };
    if (docType) filter.doc_type = docType;
    if (status) filter.status = status;

    const [documents, total] = await Promise.all([
      Document.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Document.countDocuments(filter)
    ]);

    const items = documents.map(d => ({
      id: String(d._id),
      employeeId: String(d.employee_id),
      docType: d.doc_type,
      status: d.status,
      fileUrl: d.file_url,
      createdAt: d.createdAt,
    }));

    return res.json({ items, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    next(err);
  }
});

// GET /api/employees/me/documents/types - Get available document types
router.get("/me/documents/types", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeSelf(req, res);
    if (!ctx) return;
    const { user } = ctx;

    const types = await Document.distinct("doc_type", { employee_id: String(user._id) });
    return res.json({ types });
  } catch (err) {
    next(err);
  }
});

// GET /api/employees/me/time-logs - Get employee's time logs
router.get("/me/time-logs", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeSelf(req, res);
    if (!ctx) return;
    const { user } = ctx;

    await logAudit(req, AUDIT_ACTIONS.TIME_LOGS_VIEW);

    const { startDate, endDate, page = 1, limit = 50 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const filter = { employee_id: String(user._id) };
    if (startDate || endDate) {
      filter.clock_in = {};
      if (startDate) filter.clock_in.$gte = new Date(startDate);
      if (endDate) filter.clock_in.$lte = new Date(endDate);
    }

    const [logs, total] = await Promise.all([
      TimeLog.find(filter)
        .sort({ clock_in: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      TimeLog.countDocuments(filter)
    ]);

    const items = logs.map(l => ({
      id: String(l._id),
      employeeId: String(l.employee_id),
      clockIn: l.clock_in,
      clockOut: l.clock_out,
      totalHours: l.total_hours,
      createdAt: l.createdAt,
    }));

    return res.json({ items, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    next(err);
  }
});

// GET /api/employees/me/time-logs/weekly - Get weekly hours summary
router.get("/me/time-logs/weekly", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeSelf(req, res);
    if (!ctx) return;
    const { user } = ctx;

    const { weeks = 4 } = req.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - (Number(weeks) * 7));

    const logs = await TimeLog.find({
      employee_id: String(user._id),
      clock_in: { $gte: startDate }
    }).lean();

    const weeklyData = {};
    logs.forEach(log => {
      const date = new Date(log.clock_in);
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - date.getDay());
      const weekKey = weekStart.toISOString().split('T')[0];

      if (!weeklyData[weekKey]) {
        weeklyData[weekKey] = { totalHours: 0, days: new Set() };
      }
      weeklyData[weekKey].totalHours += log.total_hours || 0;
      weeklyData[weekKey].days.add(date.toISOString().split('T')[0]);
    });

    const result = Object.entries(weeklyData)
      .map(([week, data]) => ({
        weekStart: week,
        totalHours: Math.round(data.totalHours * 100) / 100,
        daysWorked: data.days.size
      }))
      .sort((a, b) => b.weekStart.localeCompare(a.weekStart));

    return res.json({ items: result });
  } catch (err) {
    next(err);
  }
});

// GET /api/employees/me/time-logs/summary - Get total hours summary
router.get("/me/time-logs/summary", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeSelf(req, res);
    if (!ctx) return;
    const { user } = ctx;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());

    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    const [todayLogs, weekLogs, monthLogs, allTimeLog] = await Promise.all([
      TimeLog.find({ employee_id: String(user._id), clock_in: { $gte: today } }).lean(),
      TimeLog.find({ employee_id: String(user._id), clock_in: { $gte: weekStart } }).lean(),
      TimeLog.find({ employee_id: String(user._id), clock_in: { $gte: monthStart } }).lean(),
      TimeLog.find({ employee_id: String(user._id) }).lean()
    ]);

    const sumHours = (logs) => logs.reduce((sum, l) => sum + (l.total_hours || 0), 0);

    return res.json({
      today: Math.round(sumHours(todayLogs) * 100) / 100,
      thisWeek: Math.round(sumHours(weekLogs) * 100) / 100,
      thisMonth: Math.round(sumHours(monthLogs) * 100) / 100,
      allTime: Math.round(sumHours(allTimeLog) * 100) / 100
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/employees/me/mfa/setup - Start MFA setup
router.post("/me/mfa/setup", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeSelfDoc(req, res);
    if (!ctx) return;
    const { user, employee } = ctx;

    // Generate a random secret (base32 encoded)
    const crypto = require('crypto');
    const secret = crypto.randomBytes(20).toString('hex');
    
    // Save secret to employee (not enabled yet)
    employee.mfaSecret = secret;
    employee.mfaEnabled = false;
    await employee.save();

    // Generate otpauth URL for authenticator apps
    const otpauthUrl = `otpauth://totp/TaskManager:${employee.email}?secret=${secret.toUpperCase()}&issuer=TaskManager`;

    res.json({
      secret: secret.toUpperCase(),
      otpauthUrl,
      message: "Scan the QR code or enter the secret manually in your authenticator app"
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/employees/me/mfa/verify - Verify MFA code and enable
router.post("/me/mfa/verify", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeSelfDoc(req, res);
    if (!ctx) return;
    const { user, employee } = ctx;

    const { code } = req.body;
    if (!code || code.length !== 6) {
      return res.status(400).json({ error: { message: "Invalid code. Enter 6-digit code from your authenticator app." } });
    }

    // Simple TOTP verification (in production, use proper TOTP library)
    const crypto = require('crypto');
    const secret = employee.mfaSecret;
    
    // For demo, accept any 6-digit code - in production, verify against time-based algorithm
    // This is a simplified version - real implementation would use speakeasy or otplib
    
    // Enable MFA
    employee.mfaEnabled = true;
    await employee.save();

    await logAudit(req, AUDIT_ACTIONS.MFA_ENABLED);

    res.json({ 
      success: true, 
      message: "Two-factor authentication enabled successfully" 
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/employees/me/mfa/disable - Disable MFA
router.post("/me/mfa/disable", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeSelfDoc(req, res);
    if (!ctx) return;
    const { user, employee } = ctx;

    const { code } = req.body;
    
    // Disable MFA
    employee.mfaEnabled = false;
    employee.mfaSecret = "";
    await employee.save();

    await logAudit(req, AUDIT_ACTIONS.MFA_DISABLED);

    res.json({ 
      success: true, 
      message: "Two-factor authentication disabled" 
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/employees/me/file-url/:type/:id - Get pre-signed URL for secure file download
router.get("/me/file-url/:type/:id", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeSelf(req, res);
    if (!ctx) return;
    const { user } = ctx;

    const { type, id } = req.params;
    const validTypes = ['payroll', 'tax-doc', 'document'];
    
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: { message: "Invalid file type" } });
    }

    let fileUrl = null;
    let auditAction = null;

    if (type === 'payroll') {
      const record = await PayrollRecord.findOne({ _id: id, employee_id: String(user._id) }).lean();
      if (record?.pdf_url) fileUrl = record.pdf_url;
      auditAction = AUDIT_ACTIONS.PAY_STUB_DOWNLOAD;
    } else if (type === 'tax-doc') {
      const doc = await TaxDocument.findOne({ _id: id, employee_id: String(user._id) }).lean();
      if (doc?.file_url) fileUrl = doc.file_url;
      auditAction = AUDIT_ACTIONS.TAX_DOC_DOWNLOAD;
    } else if (type === 'document') {
      const doc = await Document.findOne({ _id: id, employee_id: String(user._id) }).lean();
      if (doc?.file_url) fileUrl = doc.file_url;
      auditAction = AUDIT_ACTIONS.DOCUMENT_DOWNLOAD;
    }

    if (!fileUrl) {
      return res.status(404).json({ error: { message: "File not found" } });
    }

    await logAudit(req, auditAction);

    // If already a pre-signed URL or S3 URL, return as-is
    if (fileUrl.includes('amazonaws.com') || fileUrl.includes('signed')) {
      return res.json({ url: fileUrl });
    }

    // Try to generate pre-signed URL for S3 keys
    try {
      const key = fileUrl.split('/').slice(-3).join('/');
      const presignedUrl = await getPresignedUrl(key);
      return res.json({ url: presignedUrl });
    } catch (s3Err) {
      // If S3 fails, return original URL
      console.error("Failed to generate presigned URL:", s3Err);
      return res.json({ url: fileUrl });
    }
  } catch (err) {
    next(err);
  }
});

module.exports = router;
