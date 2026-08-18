const nodemailer = require("nodemailer");
const SystemSettings = require("../models/SystemSettings");
const { decrypt } = require("../lib/encryption");


/**
 * Sends an email using the global system settings.
 * @param {Object} options
 * @param {string} options.to - Recipient email
 * @param {string} options.templateKey - Key of the template to use (e.g., 'userRegistration')
 * @param {Object} options.variables - Variables to replace in the template (e.g., { name: 'John' })
 */
async function sendSystemEmail({ to, templateKey, variables = {} }) {
  try {
    const settings = await SystemSettings.findOne({ key: "global" });
    if (!settings) {
      console.warn("No system settings found. Cannot send email.");
      return { sent: false, reason: "No system settings found in database. Please save System Settings first." };
    }

    const { emailConfig, templates } = settings;
    let template = templates ? templates[templateKey] : null;

    if (!template && templateKey === "patentExpiration") {
      template = {
        enabled: true,
        subject: "ALERT: Patent Expiring - {patentName}",
        body: "Hello {name},\n\nThis is an automated notification to inform you that the patent '{patentName}' is expiring in {daysUntilExpiration} days (Expiration Date: {expirationDate}).\n\nApplication Number: {applicationNumber}\nCategory: {category}\n\nPlease take necessary actions.\n\nBest regards,\nTask Manager System",
      };
    }

    if (!template && templateKey === "forgotPassword") {
      template = {
        enabled: true,
        subject: "Password Reset Code - Task Manager",
        body: "Hello {name},\n\nYou have requested a password reset for your Task Manager account.\n\nYour 6-digit verification code is: {code}\n\nIMPORTANT: This code will expire in 60 minutes.\n\nIf you did not request a password reset, please ignore this email.\n\nBest regards,\nTask Manager System",
      };
    }

    if (!template && templateKey === "patentFiled") {
      template = {
        enabled: true,
        subject: "NEW PATENT FILED: {patentName}",
        body: "Hello {name},\n\nA new patent has been filed in the system.\n\nPatent Name: {patentName}\nFiling Type: {filingType}\nFiling Date: {filingDate}\nExpiration Date: {expirationDate}\nApplication Number: {applicationNumber}\nCategory: {category}\nNotes: {notes}\nFiled By: {createdBy}\n\nBest regards,\nTask Manager System",
      };
    }

    if (!template || template.enabled === false) {
      const msg = `Template '${templateKey}' is ${!template ? "not found" : "disabled"}.`;
      console.log(msg, "Skipping email.");
      return { sent: false, reason: msg + " Enable it in System Email Settings." };
    }

    if (!emailConfig || !emailConfig.host || !emailConfig.user || !emailConfig.pass) {
      const missing = [];
      if (!emailConfig) { missing.push("entire emailConfig"); }
      else {
        if (!emailConfig.host) missing.push("SMTP Host");
        if (!emailConfig.user) missing.push("SMTP User");
        if (!emailConfig.pass) missing.push("SMTP Password");
      }
      const msg = `SMTP configuration incomplete — missing: ${missing.join(", ")}.`;
      console.warn(msg);
      return { sent: false, reason: msg + " Configure these in System Email Settings." };
    }

    let decryptedPass;
    try {
      decryptedPass = decrypt(emailConfig.pass);
    } catch (e) {
      decryptedPass = emailConfig.pass; // fallback if password was stored unencrypted
    }

    const transporter = nodemailer.createTransport({
      host: emailConfig.host,
      port: emailConfig.port,
      secure: emailConfig.secure,
      auth: {
        user: emailConfig.user,
        pass: decryptedPass,
      },
      tls: { rejectUnauthorized: false },
    });

    let subject = template.subject || (templateKey === "patentExpiration" ? "ALERT: Patent Expiring - {patentName}" : (templateKey === "patentFiled" ? "NEW PATENT FILED: {patentName}" : "Task Manager Notification"));
    let body = template.body || (templateKey === "patentExpiration" ? "Hello {name},\n\nThe patent '{patentName}' is expiring in {daysUntilExpiration} days (Expiration Date: {expirationDate}).\n\nApplication Number: {applicationNumber}\nCategory: {category}\n\nTask Manager System" : "Hello {name},\n\nYou have an update in the Task Manager System.");

    // Replace variables in subject and body
    Object.keys(variables).forEach((key) => {
      const placeholder = new RegExp(`{${key}}`, "g");
      subject = subject.replace(placeholder, variables[key] ?? "");
      body = body.replace(placeholder, variables[key] ?? "");
    });

    const fromEmail = emailConfig.fromAddress || emailConfig.user;
    const fromField = emailConfig.senderName
      ? `${emailConfig.senderName} <${fromEmail}>`
      : fromEmail;

    const mailOptions = {
      from: fromField,
      to,
      subject,
      text: body,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`Email sent: ${info.messageId}`);
    return { sent: true, reason: "OK" };
  } catch (err) {
    let friendlyMsg = err.message || "Unknown SMTP error";
    if (friendlyMsg.includes("ECONNREFUSED")) {
      friendlyMsg = "ECONNREFUSED — Cannot connect to SMTP server. Check host and port.";
    } else if (friendlyMsg.includes("ENOTFOUND")) {
      friendlyMsg = "SMTP host not found. Check the host address.";
    } else if (friendlyMsg.includes("self signed")) {
      friendlyMsg = "SSL certificate error (self-signed). Usually safe for internal servers.";
    } else if (friendlyMsg.includes("535") || friendlyMsg.includes("Invalid login")) {
      friendlyMsg = "Authentication failed — check SMTP username/password (use App Password for Gmail/Outlook).";
    } else if (friendlyMsg.includes("ETIMEDOUT")) {
      friendlyMsg = "Connection timed out. Check SMTP host, port, and firewall settings.";
    }
    console.error("Error sending system email:", err);
    return { sent: false, reason: friendlyMsg };
  }
}

/**
 * Sends a raw email using the global system settings without requiring a DB template.
 */
async function sendRawEmail({ to, subject, body }) {
  try {
    const settings = await SystemSettings.findOne({ key: "global" });
    if (!settings) return false;

    const { emailConfig } = settings;
    if (!emailConfig.host || !emailConfig.user || !emailConfig.pass) return false;

    let decryptedPass;
    try { decryptedPass = decrypt(emailConfig.pass); } 
    catch (e) { decryptedPass = emailConfig.pass; }

    const transporter = nodemailer.createTransport({
      host: emailConfig.host,
      port: emailConfig.port,
      secure: emailConfig.secure,
      auth: { user: emailConfig.user, pass: decryptedPass },
      tls: { rejectUnauthorized: false },
    });

    const fromEmail = emailConfig.fromAddress || emailConfig.user;
    const fromField = emailConfig.senderName ? `${emailConfig.senderName} <${fromEmail}>` : fromEmail;

    const info = await transporter.sendMail({ from: fromField, to, subject, text: body });
    return true;
  } catch (err) {
    console.error("Error sending raw email:", err);
    return false;
  }
}

module.exports = { sendSystemEmail, sendRawEmail };
