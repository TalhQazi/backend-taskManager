const express = require("express");
const { z } = require("zod");
const SystemSettings = require("../models/SystemSettings");
const Settings = require("../models/Settings");
const { requireAuth } = require("../middleware/auth");
const nodemailer = require("nodemailer");
const { decrypt } = require("../lib/encryption");

const router = express.Router();

// Get employee email preferences (requires employee auth)
router.get("/settings", requireAuth, async (req, res, next) => {
  try {
    const userId = String(req.user?.sub || req.user?.id || req.user?._id || "");
    if (!userId) {
      return res.status(401).json({ error: { message: "Unauthorized" } });
    }

    let settings = await Settings.findOne({ userId }).lean();
    if (!settings) {
      const created = await Settings.create({ userId, role: req.user?.role || "" });
      settings = created.toObject();
    }

    const defaultPrefs = {
      taskAssignment: true,
      projectAssignment: true,
      commentAdded: true,
      replyAdded: true,
      taskCompleted: true,
      eodMissAlert: true,
      eodComment: true,
      messageAlert: true,
      systemAlert: true,
      patentExpiration: true,
      complianceReminder: true,
      userRegistration: true,
      lunchBreakAlert: true,
      websiteDownAlert: true,
    };

    res.json({ 
      item: { 
        preferences: settings.emailPreferences || defaultPrefs,
        webPreferences: settings.webPreferences || defaultPrefs
      }
    });

  } catch (err) {
    next(err);
  }
});

// Update employee email preferences (requires employee auth)
router.put("/settings", requireAuth, async (req, res, next) => {
  try {
    const userId = String(req.user?.sub || req.user?.id || req.user?._id || "");
    if (!userId) {
      return res.status(401).json({ error: { message: "Unauthorized" } });
    }

    const { preferences, webPreferences } = req.body;
    const update = {};
    if (preferences) update.emailPreferences = preferences;
    if (webPreferences) update.webPreferences = webPreferences;

    const updated = await Settings.findOneAndUpdate(
      { userId },
      { $set: update },
      { new: true, upsert: true }
    ).lean();

    res.json({ 
      item: { 
        preferences: updated.emailPreferences,
        webPreferences: updated.webPreferences
      }
    });

  } catch (err) {
    next(err);
  }
});

// Get system email templates (public for employees)
router.get("/system-templates", requireAuth, async (req, res, next) => {
  try {
    let settings = await SystemSettings.findOne({ key: "global" }).lean();
    
    if (!settings) {
      settings = {
        templates: {
          userRegistration: { enabled: false, subject: "", body: "" },
          managerRegistration: { enabled: false, subject: "", body: "" },
          forgotPassword: { enabled: false, subject: "", body: "" },
          taskAssignment: { enabled: false, subject: "", body: "" },
          fileAttachment: { enabled: false, subject: "", body: "" },
          commentAdded: { enabled: false, subject: "", body: "" },
          replyAdded: { enabled: false, subject: "", body: "" },
          projectAssignment: { enabled: false, subject: "", body: "" },
          projectReassignment: { enabled: false, subject: "", body: "" },
        }
      };
    }

    // Return only the templates (no SMTP credentials)
    res.json({ 
      item: {
        templates: settings.templates || {}
      }
    });

  } catch (err) {
    next(err);
  }
});

// Send test email to employee
router.post("/test", requireAuth, async (req, res, next) => {
  try {
    const userEmail = req.user?.email || req.user?.username;
    if (!userEmail || !String(userEmail).includes("@")) {
      return res.status(400).json({ 
        error: { message: "User email not found. Please update your profile." } 
      });
    }

    let settings = await SystemSettings.findOne({ key: "global" });
    
    // If no settings exist, create default ones
    if (!settings) {
      settings = await SystemSettings.create({
        key: "global",
        emailConfig: {
          host: "",
          port: 587,
          user: "",
          pass: "",
          secure: false,
          fromAddress: "",
          senderName: "Task Manager",
        },
        templates: {
          userRegistration: { enabled: false, subject: "", body: "" },
          managerRegistration: { enabled: false, subject: "", body: "" },
          forgotPassword: { enabled: false, subject: "", body: "" },
          taskAssignment: { enabled: false, subject: "", body: "" },
          fileAttachment: { enabled: false, subject: "", body: "" },
          commentAdded: { enabled: false, subject: "", body: "" },
          replyAdded: { enabled: false, subject: "", body: "" },
          projectAssignment: { enabled: false, subject: "", body: "" },
          projectReassignment: { enabled: false, subject: "", body: "" },
        }
      });
    }

    const { emailConfig } = settings;
    
    // Check if email is configured
    if (!emailConfig?.host || !emailConfig?.user || !emailConfig?.pass) {
      return res.status(400).json({ 
        error: { 
          message: "Email system not configured by administrator. Please contact your admin to configure SMTP settings." 
        } 
      });
    }

    let decryptedPass;
    try {
      decryptedPass = decrypt(emailConfig.pass);
    } catch (e) {
      decryptedPass = emailConfig.pass;
    }

    const transporter = nodemailer.createTransport({
      host: emailConfig.host,
      port: emailConfig.port,
      secure: emailConfig.secure,
      auth: {
        user: emailConfig.user,
        pass: decryptedPass,
      },
    });

    const fromAddress = emailConfig.fromAddress || emailConfig.user;
    const senderName = emailConfig.senderName || "Task Manager";

    // Send test email
    await transporter.sendMail({
      from: `"${senderName}" <${fromAddress}>`,
      to: userEmail,
      subject: "Test Email - Task Manager",
      html: `
        <h2>Test Email Notification</h2>
        <p>Hello,</p>
        <p>This is a test email to verify your notification preferences are working correctly.</p>
        <p>If you received this email, your email settings are configured properly.</p>
        <br/>
        <p>Best regards,<br/>Task Manager System</p>
      `,
    });

    res.json({ 
      ok: true,
      message: `Test email sent successfully to ${userEmail}` 
    });

  } catch (err) {
    // Handle SMTP errors gracefully
    let errorMsg = err.message || "Failed to send test email";
    
    if (err.message.includes("ECONNREFUSED")) {
      errorMsg = "ECONNREFUSED: Could not connect to email server. Check SMTP host and port.";
    } else if (err.message.includes("self signed")) {
      errorMsg = "Certificate error: This is usually safe for internal servers.";
    } else if (err.message.includes("535")) {
      errorMsg = "Authentication failed: Check your SMTP credentials or use an App Password.";
    }

    res.status(500).json({ 
      error: { message: errorMsg }
    });
  }
});

module.exports = router;
