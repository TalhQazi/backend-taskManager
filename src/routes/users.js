const express = require("express");
const bcrypt = require("bcryptjs");
const { z } = require("zod");

const Employee = require("../models/Employee");
const Settings = require("../models/Settings");
const { createNotification } = require("../utils/notifications");
const { requireAuth, requireRole } = require("../middleware/auth");
const { sendSystemEmail } = require("../lib/email");

const router = express.Router();

// Map Employee record → User-shaped response
function employeeToUser(emp) {
  if (!emp) return null;
  const { passwordHash, resetPasswordCode, resetPasswordExpires, ...rest } = emp;
  return {
    ...rest,
    id: String(emp._id),
    username: emp.email || "",
    role: emp.userRole || "",
    status: emp.userStatus || "active",
  };
}

const resetPasswordSchema = z.object({
  newPassword: z.string().min(6, "Password must be at least 6 characters"),
  confirmPassword: z.string(),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().optional().default(""),
  password: z.string().min(6),
  role: z.enum(["super-admin", "admin", "manager", "team-lead", "employee", "coder"]),
  status: z.enum(["active", "inactive", "pending"]).optional().default("active"),
  department: z.string().optional().default(""),
  phone: z.string().optional().default(""),
});

const updateSchema = z.object({
  name: z.string().optional(),
  email: z.string().optional(),
  password: z.string().min(6).optional(),
  role: z.enum(["super-admin", "admin", "manager", "team-lead", "employee", "coder"]).optional(),
  status: z.enum(["active", "inactive", "pending"]).optional(),
  department: z.string().optional(),
  phone: z.string().optional(),
}).partial();

// Get all users/employees for messaging — accessible by all authenticated users
router.get("/all", requireAuth, async (_req, res, next) => {
  try {
    const employees = await Employee.find({ status: { $ne: "inactive" } }).sort({ name: 1 }).lean();

    const items = employees.map((e) => ({
      id: String(e._id),
      name: e.name,
      username: e.email || e.name,
      email: e.email,
      role: e.userRole || "employee",
      status: e.userStatus || "active",
      avatarUrl: "",
      avatarDataUrl: "",
    }));

    res.json({ items });
  } catch (err) {
    next(err);
  }
});

// List all users (Employee Directory as user list)
router.get("/", requireAuth, requireRole(["super-admin", "admin", "manager"]), async (_req, res, next) => {
  try {
    const employees = await Employee.find().sort({ createdAt: -1 }).lean();

    // Fetch settings for avatar data (keyed by Employee._id)
    const ids = employees.map((e) => String(e._id));
    const settings = await Settings.find({ userId: { $in: ids } }).lean();
    const settingsMap = new Map(settings.map((s) => [String(s.userId), s]));

    const items = employees.map((e) => {
      const s = settingsMap.get(String(e._id));
      const avatarUrl = s?.avatarDataUrl || s?.avatarUrl || "";
      return { ...employeeToUser(e), avatarUrl, avatarDataUrl: avatarUrl };
    });

    res.json({ items });
  } catch (err) {
    next(err);
  }
});

// Create user (creates Employee record with login credentials)
router.post("/", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload" } });
    }

    const { name, email, password, role, status, department, phone } = parsed.data;

    const existing = await Employee.findOne({
      email: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, "\$&")}$`, "i"),
    }).lean();
    if (existing) {
      return res.status(409).json({ error: { message: "An employee with this email already exists" } });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const created = await Employee.create({
      name,
      email,
      passwordHash,
      userRole: role,
      userStatus: status,
      department: department || "",
      phone: phone || "",
      initials: name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2),
    });

    if (email) {
      const templateKey = role === "manager" ? "managerRegistration" : "userRegistration";
      sendSystemEmail({
        to: email,
        templateKey,
        variables: { name },
      }).catch(() => {});
    }

    return res.status(201).json({ item: employeeToUser(created.toObject()) });
  } catch (err) {
    return next(err);
  }
});

// Update user (updates Employee record)
router.put("/:id", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload" } });
    }

    const patch = {};
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.email !== undefined) patch.email = parsed.data.email;
    if (parsed.data.role !== undefined) patch.userRole = parsed.data.role;
    if (parsed.data.status !== undefined) patch.userStatus = parsed.data.status;
    if (parsed.data.department !== undefined) patch.department = parsed.data.department;
    if (parsed.data.phone !== undefined) patch.phone = parsed.data.phone;
    if (parsed.data.password) {
      patch.passwordHash = await bcrypt.hash(parsed.data.password, 10);
    }

    const updated = await Employee.findByIdAndUpdate(req.params.id, patch, { new: true }).lean();
    if (!updated) {
      return res.status(404).json({ error: { message: "User not found" } });
    }

    await createNotification({
      actor: req.user?.name || req.user?.username || "Admin",
      actorRole: req.user?.role || "admin",
      action: "updated",
      resourceType: "user",
      resourceName: updated.name || updated.email,
      details: patch.userStatus ? `Status: ${patch.userStatus}` : "",
      resourceId: String(req.params.id),
    });

    const s = await Settings.findOne({ userId: String(updated._id) }).lean();
    const avatarUrl = s?.avatarDataUrl || s?.avatarUrl || "";

    return res.json({ item: { ...employeeToUser(updated), avatarUrl, avatarDataUrl: avatarUrl } });
  } catch (err) {
    return next(err);
  }
});

// Delete user (deletes Employee record)
router.delete("/:id", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const deleted = await Employee.findByIdAndDelete(req.params.id).lean();
    if (!deleted) {
      return res.status(404).json({ error: { message: "User not found" } });
    }

    await createNotification({
      actor: req.user?.name || req.user?.username || "Admin",
      actorRole: req.user?.role || "admin",
      action: "deleted",
      resourceType: "user",
      resourceName: deleted.name || deleted.email,
      resourceId: String(req.params.id),
    });

    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

// Archive user (soft-delete Employee, remove from projects/tasks)
router.post("/:id/archive", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const employee = await Employee.findById(req.params.id).lean();
    if (!employee) {
      return res.status(404).json({ error: { message: "User not found" } });
    }

    const Archive = require("../models/Archive");
    const Project = require("../models/Project");
    const Task = require("../models/Task");
    const { cacheDel } = require("../lib/cache");

    const identifiers = [employee.name, employee.email].filter(Boolean);

    const affectedProjects = await Project.find({ assignees: { $in: identifiers } }).select("_id").lean();
    const projectIds = affectedProjects.map((p) => String(p._id));

    await Project.updateMany(
      { assignees: { $in: identifiers } },
      { $pull: { assignees: { $in: identifiers } } }
    );
    await Project.updateMany(
      { teamLead: { $in: identifiers } },
      { $set: { teamLead: "" } }
    );

    await Task.updateMany(
      { assignees: { $in: identifiers } },
      { $pull: { assignees: { $in: identifiers } } }
    );
    await Task.updateMany(
      { assignee: { $in: identifiers } },
      { $set: { assignee: "" } }
    );
    await Task.updateMany(
      { employee: { $in: identifiers } },
      { $set: { employee: "" } }
    );

    await cacheDel("tasks:list:*");
    for (const pid of projectIds) {
      await cacheDel(`project:${pid}`);
    }

    await Archive.create({
      itemType: "user",
      itemData: {
        originalId: String(employee._id),
        name: employee.name,
        email: employee.email,
        username: employee.email,
        role: employee.userRole,
        status: employee.userStatus,
        createdAt: employee.createdAt,
      },
      parentType: "system",
      parentId: String(employee._id),
      parentName: employee.name || employee.email,
      archivedByUserId: String(req.user?.sub || ""),
      archivedByUsername: String(req.user?.username || ""),
      archivedByRole: String(req.user?.role || ""),
    });

    await Employee.findByIdAndDelete(req.params.id);

    await createNotification({
      actor: req.user?.username || "Admin",
      actorRole: req.user?.role || "admin",
      action: "archived",
      resourceType: "user",
      resourceName: employee.name || employee.email,
      resourceId: String(employee._id),
    });

    return res.json({ ok: true, message: "User archived successfully" });
  } catch (err) {
    return next(err);
  }
});

// Super-admin only: Reset any user's password
router.post("/:id/reset-password", requireAuth, requireRole(["super-admin"]), async (req, res, next) => {
  try {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      const errorMsg = parsed.error.errors.map((e) => e.message).join(", ");
      return res.status(400).json({ error: { message: errorMsg } });
    }

    const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);

    const updated = await Employee.findByIdAndUpdate(
      req.params.id,
      { passwordHash },
      { new: true }
    ).lean();

    if (!updated) {
      return res.status(404).json({ error: { message: "User not found" } });
    }

    return res.json({
      success: true,
      message: "Password reset successfully",
      item: employeeToUser(updated),
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
