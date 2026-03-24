const express = require("express");
const { z } = require("zod");
const bcrypt = require("bcryptjs");

const Employee = require("../models/Employee");
const User = require("../models/User");
const Task = require("../models/Task");
const Event = require("../models/Event");
const TimeEntry = require("../models/TimeEntry");
const Message = require("../models/Message");
const ActivityLog = require("../models/ActivityLog");
const Settings = require("../models/Settings");
const { createNotification } = require("../utils/notifications");
const { requireAuth, requireRole } = require("../middleware/auth");

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

 function getDayRange(d = new Date()) {
   const start = new Date(d);
   start.setHours(0, 0, 0, 0);
   const end = new Date(d);
   end.setHours(23, 59, 59, 999);
   return { start, end };
 }

 async function requireEmployeeSelf(req, res) {
   const role = String(req.user?.role || "").trim();
   if (role !== "employee") {
     res.status(403).json({ error: { message: "Forbidden" } });
     return null;
   }

   const userId = String(req.user?.sub || "").trim();
   if (!userId) {
     res.status(401).json({ error: { message: "Unauthorized" } });
     return null;
   }

   const user = await User.findById(userId, { name: 1, username: 1, email: 1, role: 1 }).lean();
   if (!user) {
     res.status(401).json({ error: { message: "Unauthorized" } });
     return null;
   }

   const email = String(user.email || "").trim();
   const employee = email
     ? await Employee.findOne({ email }, { passwordHash: 0 }).lean()
     : null;

   if (!employee) {
     res.status(404).json({ error: { message: "Employee profile not found" } });
     return null;
   }

   return { user, employee };
 }

 // Employee self endpoints
 router.get("/me", requireAuth, async (req, res, next) => {
   try {
     const ctx = await requireEmployeeSelf(req, res);
     if (!ctx) return;
     const { user, employee } = ctx;
     res.json({
       item: {
         id: String(employee._id),
         name: employee.name,
         email: employee.email,
         phone: employee.phone || "",
         company: employee.company || "",
         location: employee.location || "",
         status: employee.status || "active",
         username: user.username || user.email || "",
         role: "employee",
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

     const tasks = await Task.find({ assignees: { $in: candidates } }).sort({ updatedAt: -1 }).lean();

     res.json({
       items: tasks.map((t) => ({
         id: String(t._id),
         title: t.title,
         status: t.status,
         priority: t.priority,
         dueDate: t.dueDate ? new Date(t.dueDate).toISOString().slice(0, 10) : "",
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

     const { start, end } = getDayRange(new Date());

     const [tasks, schedule, todayEntry, unreadMessages] = await Promise.all([
       Task.find({ assignees: { $in: candidates } }).lean(),
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
    const items = await Employee.find().sort({ createdAt: -1 }).lean();
    
    // Get unique emails from employees to fetch their settings
    const employeeEmails = items.map(e => e.email).filter(Boolean);
    const settings = await Settings.find({ 
      $or: [
        { email: { $in: employeeEmails } },
        { userId: { $in: items.map(e => String(e._id)) } }
      ]
    }).lean();
    
    // Create a map of email -> avatarUrl
    const avatarMap = new Map();
    settings.forEach(s => {
      if (s.avatarDataUrl || s.avatarUrl) {
        const avatar = s.avatarDataUrl || s.avatarUrl;
        if (s.email) avatarMap.set(s.email, avatar);
        if (s.userId) avatarMap.set(String(s.userId), avatar);
      }
    });
    
    // Merge employee data with avatar
    const itemsWithAvatars = items.map(e => {
      const avatarUrl = avatarMap.get(e.email) || avatarMap.get(String(e._id)) || "";
      return { ...e, avatarUrl, avatarDataUrl: avatarUrl };
    });
    
    res.json({ items: itemsWithAvatars.map(withId) });
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

    // Create corresponding user account for login
    try {
      // Use email as username (or generate from name if no email)
      const userUsername = parsed.data.email || parsed.data.name.toLowerCase().replace(/\s+/g, '.');
      await User.create({
        name: parsed.data.name,
        email: parsed.data.email || "",
        username: userUsername,
        passwordHash: passwordHash,
        role: "employee",
        status: "active",
      });
    } catch (userErr) {
      // Log but don't fail - employee was created successfully
      console.error("Failed to create user account for employee:", userErr.message);
    }

    const obj = created.toObject();
    
    // Log activity
    await logActivity(req, "EMPLOYEE_CREATE", "employee", created._id, created.name, `Created employee: ${created.name}`);
    
    // Create notification for all admin/manager users
    await createNotification({
      actor: req.user?.username || req.user?.name || "Admin",
      actorRole: req.user?.role || "admin",
      action: "created",
      resourceType: "employee",
      resourceName: created.name,
      resourceId: String(created._id),
    });
    
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

    // Sync user account if password was updated
    if (patch.passwordHash) {
      try {
        await User.findOneAndUpdate(
          { email: updated.email },
          { passwordHash: patch.passwordHash }
        );
      } catch (userErr) {
        console.error("Failed to update user password:", userErr.message);
      }
    }

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

router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const deleted = await Employee.findByIdAndDelete(req.params.id).lean();
    if (!deleted) {
      return res.status(404).json({ error: { message: "Employee not found" } });
    }
    
    // Also delete corresponding user account
    try {
      await User.deleteOne({ email: deleted.email });
    } catch (userErr) {
      console.error("Failed to delete user account:", userErr.message);
    }
    
    // Log activity
    await logActivity(req, "EMPLOYEE_DELETE", "employee", req.params.id, deleted.name, `Deleted employee: ${deleted.name}`);
    
    // Create notification for all admin/manager users
    await createNotification({
      actor: req.user?.username || req.user?.name || "Admin",
      actorRole: req.user?.role || "admin",
      action: "deleted",
      resourceType: "employee",
      resourceName: deleted.name,
      resourceId: String(req.params.id),
    });
    
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

    // Also update user account password
    try {
      await User.findOneAndUpdate(
        { email: updated.email },
        { passwordHash: passwordHash }
      );
    } catch (userErr) {
      console.error("Failed to update user password:", userErr.message);
    }

    return res.json({ success: true, message: "Password reset successfully" });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
