const express = require("express");
const bcrypt = require("bcryptjs");
const { z } = require("zod");

const User = require("../models/User");
const Employee = require("../models/Employee");
const Settings = require("../models/Settings");
const { createNotification } = require("../utils/notifications");
const { requireAuth, requireRole } = require("../middleware/auth"); 

const router = express.Router();

const resetPasswordSchema = z.object({
  newPassword: z.string().min(6, "Password must be at least 6 characters"),
  confirmPassword: z.string(),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

function withId(doc) {
  if (!doc) return doc;
  return { ...doc, id: String(doc._id) };
}

function sanitizeUser(u) {
  if (!u) return u;
  const { passwordHash, ...rest } = u;
  return withId(rest);
}

const createSchema = z.object({
  name: z.string().optional().default(""),
  email: z.string().optional().default(""),
  username: z.string().optional(),
  password: z.string().min(6),
  role: z.enum(["super-admin", "admin", "manager", "team-lead", "employee"]),
  status: z.enum(["active", "inactive", "pending"]).optional(),
});

const updateSchema = z
  .object({
    name: z.string().optional(),
    email: z.string().optional(),
    username: z.string().min(1).optional(),
    password: z.string().min(6).optional(),
    role: z.enum(["super-admin", "admin", "manager", "team-lead", "employee"]).optional(),
    status: z.enum(["active", "inactive", "pending"]).optional(),
  })
  .partial();

// Get all users for messaging (includes employees, managers, admins, super-admins)
// Accessible by all authenticated users including employees
router.get("/all", requireAuth, async (_req, res, next) => {
  try {
    // Get all users from User collection
    const users = await User.find().sort({ name: 1 }).lean();
    
    // Get all employees to merge with users
    const employees = await Employee.find().sort({ name: 1 }).lean();
    
    // Filter users and employees to only include active ones
    const activeUsers = users.filter(u => (u.status || 'active') === 'active');
    const activeEmployees = employees.filter(e => (e.status || 'active') === 'active');
    
    // Fetch settings for avatar data
    const userIds = activeUsers.map(u => String(u._id));
    const settings = await Settings.find({ userId: { $in: userIds } }).lean();
    const settingsMap = new Map(settings.map(s => [String(s.userId), s]));
    
    // Create a map of existing user emails to avoid duplicates
    const existingEmails = new Set(activeUsers.map(u => String(u.email || '').toLowerCase()));
    const existingUsernames = new Set(activeUsers.map(u => String(u.username || '').toLowerCase()));
    
    // Convert employees to user format and add to list if not already present
    const employeeUsers = activeEmployees
      .filter(e => {
        const email = String(e.email || '').toLowerCase();
        const name = String(e.name || '').toLowerCase();
        return !existingEmails.has(email) && !existingUsernames.has(name);
      })
      .map(e => ({
        id: String(e._id),
        name: e.name,
        username: e.email || e.name.toLowerCase().replace(/\s+/g, '.'),
        email: e.email,
        role: 'employee',
        status: e.status || 'active',
        avatarUrl: '',
      }));
    
    // Format users
    const formattedUsers = activeUsers.map(u => {
      const userSettings = settingsMap.get(String(u._id));
      const avatarUrl = userSettings?.avatarDataUrl || userSettings?.avatarUrl || '';
      return {
        id: String(u._id),
        name: u.name || u.username,
        username: u.username,
        email: u.email,
        role: u.role,
        status: u.status || 'active',
        avatarUrl: avatarUrl,
      };
    });
    
    // Combine users and employees
    const allUsers = [...formattedUsers, ...employeeUsers];
    
    res.json({ items: allUsers });
  } catch (err) {
    next(err);
  }
});

router.get("/", requireAuth, requireRole(["super-admin", "admin", "manager"]), async (_req, res, next) => {
  try {
    const items = await User.find().sort({ createdAt: -1 }).lean();
    
    // Fetch settings for all users to get avatar data
    const userIds = items.map(u => String(u._id));
    const settings = await Settings.find({ userId: { $in: userIds } }).lean();
    const settingsMap = new Map(settings.map(s => [String(s.userId), s]));
    
    // Merge user data with avatar from settings
    const itemsWithAvatars = items.map(u => {
      const userSettings = settingsMap.get(String(u._id));
      const avatarUrl = userSettings?.avatarDataUrl || userSettings?.avatarUrl || "";
      return { ...u, avatarUrl, avatarDataUrl: avatarUrl };
    });
    
    res.json({ items: itemsWithAvatars.map(sanitizeUser) });
  } catch (err) {
    next(err);
  }
});

router.post("/", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload" } });
    }

    const derivedUsername =
      (typeof parsed.data.username === "string" && parsed.data.username.trim())
        ? parsed.data.username.trim()
        : (typeof parsed.data.email === "string" && parsed.data.email.trim())
          ? parsed.data.email.trim()
          : (typeof parsed.data.name === "string" && parsed.data.name.trim())
            ? parsed.data.name.trim().toLowerCase().replace(/\s+/g, ".")
            : "user";

    const created = await User.create({
      ...parsed.data,
      username: derivedUsername,
      passwordHash: await bcrypt.hash(parsed.data.password, 10),
    });

    // Create notification
    await createNotification({
      actor: req.user?.username || req.user?.name || "Admin",
      actorRole: req.user?.role || "admin",
      action: "created",
      resourceType: "user",
      resourceName: created.name || created.username || created.email,
      details: `Role: ${created.role}`,
      resourceId: String(created._id),
    });

    return res.status(201).json({ item: sanitizeUser(created.toObject()) });
  } catch (err) {
    
    if (err && err.code === 11000) {
      return res.status(409).json({ error: { message: "Username already exists" } });
    }
    return next(err);
  }
});

router.put("/:id", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload" } });
    }

    const patch = { ...parsed.data };
    if (typeof patch.password === "string" && patch.password) {
      patch.passwordHash = await bcrypt.hash(patch.password, 10);
      delete patch.password;
    }

    if (!patch.username) {
      if (typeof patch.email === "string" && patch.email.trim()) {
        patch.username = patch.email.trim();
      }
    }

    const updated = await User.findByIdAndUpdate(req.params.id, patch, { new: true }).lean();
    if (!updated) {
      return res.status(404).json({ error: { message: "User not found" } });
    }

    // Create notification
    await createNotification({
      actor: req.user?.username || req.user?.name || "Admin",
      actorRole: req.user?.role || "admin",
      action: "updated",
      resourceType: "user",
      resourceName: updated.name || updated.username || updated.email,
      details: patch.status ? `Status: ${patch.status}` : "",
      resourceId: String(req.params.id),
    });

    return res.json({ item: sanitizeUser(updated) });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ error: { message: "Username already exists" } });
    }
    return next(err);
  }
});

router.delete("/:id", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const deleted = await User.findByIdAndDelete(req.params.id).lean();
    if (!deleted) {
      return res.status(404).json({ error: { message: "User not found" } });
    }

    // Create notification
    await createNotification({
      actor: req.user?.username || req.user?.name || "Admin",
      actorRole: req.user?.role || "admin",
      action: "deleted",
      resourceType: "user",
      resourceName: deleted.name || deleted.username || deleted.email,
      resourceId: String(req.params.id),
    });

    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

//Archive user instead of deleting permanently, only accessible by super-admin and admin
router.post("/:id/archive", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
   const user = await User.findById(req.params.id)
  .select("+passwordHash") 
  .lean();

    if (!user) {
      return res.status(404).json({ error: { message: "User not found" } });
    }

    const Archive = require("../models/Archive");
    const Project = require("../models/Project");
    const Task = require("../models/Task");

    // Get potential identifier strings for the user in assignees arrays
    const identifiers = [
      user.name,
      user.email,
      user.username,
      `${user.name}`.trim(),
    ].filter(Boolean);

    const { cacheDel } = require("../lib/cache");

    // Remove user from all projects and capture their IDs to clear cache
    const affectedProjects = await Project.find({ assignees: { $in: identifiers } }).select("_id").lean();
    const projectIds = affectedProjects.map(p => String(p._id));

    await Project.updateMany(
      { assignees: { $in: identifiers } },
      { $pull: { assignees: { $in: identifiers } } }
    );

    // Remove user from all tasks
    await Task.updateMany(
      { assignees: { $in: identifiers } },
      { $pull: { assignees: { $in: identifiers } } }
    );

    // Clear caches to reflect changes immediately
    await cacheDel("tasks:list:*");
    for (const pid of projectIds) {
      await cacheDel(`project:${pid}`);
    }

    await Archive.create({
      itemType: "user",
      itemData: {
        originalId: String(user._id),
        name: user.name,
        email: user.email,
        username: user.username,
        passwordHash: user.passwordHash,
        role: user.role,
        status: user.status,
        createdAt: user.createdAt,
      },
      parentType: "system",
      parentId: String(user._id),
      parentName: user.name || user.email,
      archivedByUserId: String(req.user?.sub || req.user?.id || ""),
      archivedByUsername: String(req.user?.username || ""),
      archivedByRole: String(req.user?.role || ""),
    });

    await User.findByIdAndDelete(req.params.id);

    await createNotification({
      actor: req.user?.username || "Admin",
      actorRole: req.user?.role || "admin",
      action: "archived",
      resourceType: "user",
      resourceName: user.name || user.email,
      resourceId: String(user._id),
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

    const { newPassword } = parsed.data;
    const passwordHash = await bcrypt.hash(newPassword, 10);

    const updated = await User.findByIdAndUpdate(
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
      item: sanitizeUser(updated)
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
