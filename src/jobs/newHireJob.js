const NewHireReport = require("../models/NewHireReport");
const NewHireSubmissionLog = require("../models/NewHireSubmissionLog");
const { generateMaineNewHireData, submitViaSFTP, submitViaWebForm } = require("../utils/newHireSubmissionEngine");
const { createNotification } = require("../utils/notifications");

/**
 * Main worker cron to process New Hire submissions and monitor deadlines.
 * Automatically processes pending and failed reports that have under 3 attempts.
 * Generates automated admin alerts for overdue compliance limits.
 */
async function processNewHireSubmissions() {
  const now = new Date();

  try {
    // 1. Process pending and failed submissions that are under the 3-attempt limit
    const eligibleReports = await NewHireReport.find({
      status: { $in: ["pending", "failed"] },
      attemptsCount: { $lt: 3 }
    });

    for (const report of eligibleReports) {
      report.attemptsCount += 1;
      report.lastAttemptAt = now;

      console.log(`[New Hire Cron] Executing submission attempt #${report.attemptsCount} for '${report.employeeName}'...`);

      let submissionResult = null;
      let submissionError = null;

      try {
        // Generate formatting layout
        const compiledFiling = generateMaineNewHireData(report);

        // Decide submission method: Prefer SFTP if host configured, else webform mock
        if (process.env.MAINE_SFTP_HOST) {
          submissionResult = await submitViaSFTP(report, compiledFiling);
        } else {
          submissionResult = await submitViaWebForm(report);
        }
      } catch (err) {
        submissionError = err.message;
      }

      if (submissionResult && submissionResult.success) {
        // Success workflow
        report.status = "submitted";
        report.confirmationId = submissionResult.confirmationId;
        report.errorMessage = "";
        await report.save();

        // Write immutable audit log
        await NewHireSubmissionLog.create({
          reportId: report._id,
          attemptNumber: report.attemptsCount,
          status: "submitted",
          method: submissionResult.method,
          payloadPreview: `Employer FEIN: ${report.employerFEIN} | Employee: ${report.employeeName}`,
          confirmationId: submissionResult.confirmationId
        });

        console.log(`[New Hire Cron] Successfully submitted report for '${report.employeeName}'! Confirmation ID: ${report.confirmationId}`);
      } else {
        // Failure workflow
        const finalError = submissionError || "SFTP connection timeout or browser scraping failure.";
        report.errorMessage = finalError;
        
        // If reached max attempts, flag status as permanently failed for this cycle
        if (report.attemptsCount >= 3) {
          report.status = "failed";
        }
        await report.save();

        // Write immutable audit log
        await NewHireSubmissionLog.create({
          reportId: report._id,
          attemptNumber: report.attemptsCount,
          status: "failed",
          method: process.env.MAINE_SFTP_HOST ? "sftp" : "webform",
          payloadPreview: `Employer FEIN: ${report.employerFEIN} | Employee: ${report.employeeName}`,
          errorMessage: finalError
        });

        console.error(`[New Hire Cron] Attempt #${report.attemptsCount} failed for '${report.employeeName}': ${finalError}`);

        // Notify admins if it failed completely (3 attempts reached)
        if (report.attemptsCount >= 3) {
          await createNotification({
            actor: "System Engine",
            actorRole: "system",
            action: "failed",
            resourceType: "new-hire-report",
            resourceName: report.employeeName,
            details: `Maine filing failed completely after 3 attempts: ${finalError}`,
            link: "/admin/new-hire-reporting",
            category: "TASK_ASSIGNED" // Broad alerts
          });
        }
      }
    }

    // 2. Alert admins for impending compliance deadline breaches (within 24 hours of 7-day window)
    const warningHorizon = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now
    const criticalReports = await NewHireReport.find({
      status: { $in: ["pending", "failed"] },
      countdownExpiry: { $lte: warningHorizon }
    });

    for (const report of criticalReports) {
      const hoursLeft = Math.max(0, Math.round((report.countdownExpiry.getTime() - now.getTime()) / (1000 * 60 * 60)));
      
      // Dispatch alert notification to prevent compliance penalties
      await createNotification({
        actor: "Compliance Guard",
        actorRole: "system",
        action: "warned",
        resourceType: "new-hire-report",
        resourceName: report.employeeName,
        details: `CRITICAL COMPLIANCE ALERT: Only ${hoursLeft} hours remaining to report '${report.employeeName}' to Maine before penalty.`,
        link: "/admin/new-hire-reporting",
        category: "TASK_ASSIGNED"
      });
    }

  } catch (err) {
    console.error("[New Hire Cron] Job execution failed:", err);
  }
}

module.exports = { processNewHireSubmissions };
