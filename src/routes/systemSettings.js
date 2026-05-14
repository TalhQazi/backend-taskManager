const express = require("express");
const { z } = require("zod");
const nodemailer = require("nodemailer");
const SystemSettings = require("../models/SystemSettings");
const { requireAuth } = require("../middleware/auth");
const { encrypt, decrypt } = require("../lib/encryption");


const router = express.Router();

const emailConfigSchema = z.object({
  host: z.string().default(""),
  port: z.number().default(587),
  user: z.string().default(""),
  pass: z.string().default(""),
  secure: z.boolean().default(false),
  fromAddress: z.string().default(""),
});

const templateSchema = z.object({
  enabled: z.boolean().default(false),
  subject: z.string().default(""),
  body: z.string().default(""),
});

const systemSettingsSchema = z.object({
  emailConfig: emailConfigSchema.optional(),
  templates: z.object({
    userRegistration: templateSchema.optional(),
    managerRegistration: templateSchema.optional(),
    forgotPassword: templateSchema.optional(),
    taskAssignment: templateSchema.optional(),
    fileAttachment: templateSchema.optional(),
    commentAdded: templateSchema.optional(),
    replyAdded: templateSchema.optional(),
  }).optional(),
  taskRewardSystemEnabled: z.boolean().optional(),
});


// Middleware to check if user is super-admin
const requireSuperAdmin = (req, res, next) => {
  if (req.user?.role !== "super-admin") {
    return res.status(403).json({ error: { message: "Forbidden: Super Admin access required" } });
  }
  next();
};

router.get("/", requireAuth, requireSuperAdmin, async (req, res, next) => {
  try {
    let settings = await SystemSettings.findOne({ key: "global" });
    if (!settings) {
      settings = await SystemSettings.create({ key: "global" });
    }
    
    // Decrypt password before sending to frontend
    if (settings.emailConfig && settings.emailConfig.pass) {
      try {
        settings.emailConfig.pass = decrypt(settings.emailConfig.pass);
      } catch (e) {
        // Fallback if not encrypted
      }
    }

    res.json({ item: settings });

  } catch (err) {
    next(err);
  }
});

// Non-sensitive settings for all authenticated users
router.get("/public", requireAuth, async (req, res, next) => {
  try {
    let settings = await SystemSettings.findOne({ key: "global" }).lean();
    if (!settings) {
      settings = { taskRewardSystemEnabled: true }; // Default
    }
    
    // Only return non-sensitive fields
    res.json({ 
      item: {
        taskRewardSystemEnabled: settings.taskRewardSystemEnabled ?? true
      }
    });

  } catch (err) {
    next(err);
  }
});

router.put("/", requireAuth, requireSuperAdmin, async (req, res, next) => {
  try {
    const parsed = systemSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload", details: parsed.error.format() } });
    }

    const patch = { ...parsed.data };

    // Encrypt password if provided
    if (patch.emailConfig && patch.emailConfig.pass) {
      patch.emailConfig.pass = encrypt(patch.emailConfig.pass);
    }

    const updated = await SystemSettings.findOneAndUpdate(
      { key: "global" },
      { $set: patch },
      { new: true, upsert: true }
    ).lean();
    
    // Decrypt before sending back response
    if (updated.emailConfig && updated.emailConfig.pass) {
      try {
        updated.emailConfig.pass = decrypt(updated.emailConfig.pass);
      } catch (e) {
        // ignore
      }
    }

    res.json({ item: updated });

  } catch (err) {
    next(err);
  }
});

// Test SMTP connection and send a test email
router.post("/test-email", requireAuth, requireSuperAdmin, async (req, res, next) => {
  try {
    const { to } = req.body;
    if (!to || !String(to).includes("@")) {
      return res.status(400).json({ error: { message: "A valid recipient email address is required." } });
    }

    const settings = await SystemSettings.findOne({ key: "global" });
    if (!settings) {
      return res.status(400).json({ error: { message: "No system settings found. Please save your SMTP config first." } });
    }

    const { emailConfig } = settings;
    if (!emailConfig?.host || !emailConfig?.user || !emailConfig?.pass) {
      return res.status(400).json({ error: { message: "SMTP configuration is incomplete. Host, username, and password are all required." } });
    }

    let decryptedPass;
    try {
      decryptedPass = decrypt(emailConfig.pass);
    } catch (e) {
      decryptedPass = emailConfig.pass; // fallback if not encrypted
    }

    const transporter = nodemailer.createTransport({
      host: emailConfig.host,
      port: emailConfig.port || 587,
      secure: emailConfig.secure || false,
      auth: { user: emailConfig.user, pass: decryptedPass },
      tls: { rejectUnauthorized: false },
    });

    // Verify connection first — this catches wrong host/port/credentials immediately
    await transporter.verify();

    await transporter.sendMail({
      from: emailConfig.fromAddress || emailConfig.user,
      to: String(to).trim(),
      subject: "Test Email — Task Manager System",
      text: `This is a test email from your Task Manager system.\n\nIf you received this, your SMTP configuration is working correctly.\n\nSMTP Host: ${emailConfig.host}\nPort: ${emailConfig.port}\nUser: ${emailConfig.user}`,
    });

    res.json({ ok: true, message: "Test email sent successfully!" });
  } catch (err) {
    // Return the real SMTP error so the admin can diagnose it
    res.status(400).json({ error: { message: err.message || "Failed to send test email." } });
  }
});

module.exports = router;
