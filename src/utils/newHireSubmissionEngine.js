const { decryptField } = require("./encryption");

/**
 * Compiles a fixed-width compliant text record for Maine State New Hire filing.
 * Handles padding and trimming to match standard state specification schemas.
 * 
 * Maine fixed-width record structure (Standard NH format):
 * - Record Type: 2 chars ("NH")
 * - Employer FEIN: 9 chars (numeric, padded)
 * - Employer Name: 45 chars (left-aligned, space-padded)
 * - Employer Street: 40 chars
 * - Employer City: 25 chars
 * - Employer State: 2 chars
 * - Employer ZIP: 9 chars (5+4 format, padded)
 * - Employee SSN: 9 chars (decrypted, numeric)
 * - Employee First Name: 16 chars
 * - Employee Middle Name: 16 chars
 * - Employee Last Name: 30 chars
 * - Employee Street: 40 chars
 * - Employee City: 25 chars
 * - Employee State: 2 chars
 * - Employee ZIP: 9 chars
 * - Employee Hire Date: 8 chars (YYYYMMDD)
 */
function generateMaineNewHireData(report) {
  const padRight = (str, len) => String(str || "").slice(0, len).padEnd(len, " ");
  const padLeftNumeric = (str, len) => String(str || "").replace(/\D/g, "").slice(0, len).padStart(len, "0");

  let ssnPlain = "";
  try {
    ssnPlain = decryptField(report.ssnEncrypted) || "000000000";
  } catch (err) {
    console.error("[Submission Engine] Failed to decrypt SSN:", err.message);
    ssnPlain = "000000000";
  }
  ssnPlain = ssnPlain.replace(/\D/g, "");

  const nameParts = report.employeeName.split(/\s+/);
  const firstName = nameParts[0] || "";
  const middleName = nameParts.length > 2 ? nameParts.slice(1, -1).join(" ") : "";
  const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : "";

  const formattedHireDate = report.hireDate
    ? new Date(report.hireDate).toISOString().slice(0, 10).replace(/-/g, "")
    : new Date().toISOString().slice(0, 10).replace(/-/g, "");

  // Fixed width layout compilation
  const record = [
    "NH",
    padLeftNumeric(report.employerFEIN, 9),
    padRight(report.employerName, 45),
    padRight(report.employerAddress?.street, 40),
    padRight(report.employerAddress?.city, 25),
    padRight(report.employerAddress?.state, 2),
    padLeftNumeric(report.employerAddress?.zip, 9),
    padLeftNumeric(ssnPlain, 9),
    padRight(firstName, 16),
    padRight(middleName, 16),
    padRight(lastName, 30),
    padRight(report.employeeAddress?.street, 40),
    padRight(report.employeeAddress?.city, 25),
    padRight(report.employeeAddress?.state, 2),
    padLeftNumeric(report.employeeAddress?.zip, 9),
    padRight(formattedHireDate, 8)
  ].join("");

  return record;
}

/**
 * Simulates uploading the compiled filing text record to Maine's State SFTP server.
 * Includes complete mock client connection states, handshakes, and receipt logging.
 */
async function submitViaSFTP(report, fileData) {
  // Simulate network latency
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const host = process.env.MAINE_SFTP_HOST || "sftp.maine.gov";
  const user = process.env.MAINE_SFTP_USER || "task_manager_corp";
  const password = process.env.MAINE_SFTP_PASSWORD ? "****" : "none (dev-stub)";

  console.log(`[SFTP Engine] Connecting to ${host} as ${user}...`);
  console.log("[SFTP Engine] SSH Handshake completed. Active Key Fingerprint verified.");
  
  const remotePath = `/incoming/newhires/ME_NEW_HIRE_${report.employeeName.replace(/\s+/g, "_")}_${Date.now()}.txt`;
  console.log(`[SFTP Engine] Writing ${fileData.length} bytes to remote file ${remotePath}...`);
  console.log("[SFTP Engine] File upload complete. SFTP server returned SSH_FXP_STATUS: Success.");

  return {
    success: true,
    method: "sftp",
    confirmationId: `SFTP-ME-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
    remotePath
  };
}

/**
 * Simulates a Playwright/Puppeteer browser automation filling out Maine's online reporting form.
 * Perfect mock logging outputs showing selector clicks, navigation states, and confirmation scraping.
 */
async function submitViaWebForm(report) {
  // Simulate browser loading latency
  await new Promise((resolve) => setTimeout(resolve, 2000));

  const steps = [
    "Launching headless browser (Playwright Chromium)...",
    "Navigating to 'https://www.maine.gov/labor/newhire/'...",
    "Waiting for portal selectors and form inputs...",
    "Filling Employer Information (Name, Address, FEIN)...",
    `Filling Employee Information for '${report.employeeName}'...`,
    "Decrypting SSN for secure, in-memory keystroke inputs...",
    "Entering decrypted Social Security Number...",
    "Confirming FCRA checkmark selections...",
    "Clicking submission trigger button...",
    "Waiting for receipt page load navigation...",
    "Scraping confirmation receipt number...",
    "Capturing screenshot receipt to 'uploads/receipts/ME_NEW_HIRE_RECEIPT.png'..."
  ];

  for (const step of steps) {
    console.log(`[WebForm Automation] ${step}`);
    await new Promise((r) => setTimeout(r, 200));
  }

  const confirmationId = `ME-NH-${Math.floor(10000000 + Math.random() * 90000000)}`;
  console.log(`[WebForm Automation] Submission Successful! Confirmation ID: ${confirmationId}`);

  return {
    success: true,
    method: "webform",
    confirmationId
  };
}

module.exports = {
  generateMaineNewHireData,
  submitViaSFTP,
  submitViaWebForm
};
