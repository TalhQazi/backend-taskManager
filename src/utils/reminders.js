const Company = require("../models/Company");
const { createNotification } = require("./notifications");

/**
 * Check for companies with upcoming annual report deadlines and send notifications.
 * Threshold: 30 days before due date.
 * Frequency: Once every 7 days per company.
 */
async function checkAnnualReportReminders() {
  try {
    const today = new Date();
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(today.getDate() + 30);

    // Find companies with due dates within 30 days
    const companies = await Company.find({
      annualReportDueDate: { $gte: today, $lte: thirtyDaysFromNow },
      status: "active"
    });

    for (const company of companies) {
      // Avoid duplicate reminders within a week
      const lastSent = company.lastAnnualReportReminderSent;
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(today.getDate() - 7);

      if (!lastSent || lastSent < oneWeekAgo) {
        const daysLeft = Math.ceil((company.annualReportDueDate - today) / (1000 * 60 * 60 * 24));
        
        await createNotification({
          actor: "System",
          actorRole: "admin",
          action: "upcoming deadline",
          resourceType: "annual report",
          resourceName: company.name,
          details: `Due in ${daysLeft} days (${company.annualReportDueDate.toLocaleDateString()})`,
          resourceId: String(company._id),
          category: "SYSTEM_ALERT", // We'll treat this as a special category
          link: "/admin/companies"
        });

        company.lastAnnualReportReminderSent = today;
        await company.save();
        
        console.log(`[Reminder] Annual report reminder sent for ${company.name} (Due in ${daysLeft} days)`);
      }
    }
  } catch (err) {
    console.error("[Reminder] Failed to check annual report reminders:", err);
  }
}

module.exports = { checkAnnualReportReminders };
