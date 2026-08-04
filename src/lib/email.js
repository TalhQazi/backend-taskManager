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
      return false;
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

    if (!template || template.enabled === false) {
      console.log(`Template ${templateKey} is disabled or does not exist. Skipping email.`);
      return false;
    }

    if (!emailConfig.host || !emailConfig.user || !emailConfig.pass) {
      console.warn("SMTP configuration is incomplete. Cannot send email.");
      return false;
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

    let subject = template.subject;
    let body = template.body;

    // Replace variables in subject and body
    Object.keys(variables).forEach((key) => {
      const placeholder = new RegExp(`{${key}}`, "g");
      subject = subject.replace(placeholder, variables[key]);
      body = body.replace(placeholder, variables[key]);
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
    return true;
  } catch (err) {
    console.error("Error sending system email:", err);
    return false;
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
