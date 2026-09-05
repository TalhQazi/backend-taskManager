const AlertRule = require("../models/AlertRule");

async function initializeAlertRules() {
  try {
    const count = await AlertRule.countDocuments();
    if (count === 0) {
      await AlertRule.insertMany([
        { name: "Website Down Alert", targetType: "WEBSITE", condition: "DOWN", isEnabled: true },
        { name: "Website Degraded Alert", targetType: "WEBSITE", condition: "DEGRADED", isEnabled: true },
        { name: "SSL Certificate Expiring Alert", targetType: "WEBSITE", condition: "SSL_EXPIRING", isEnabled: true },
        { name: "Server CPU Alert", targetType: "SERVER", condition: "HIGH_CPU", threshold: 90, isEnabled: true },
        { name: "Server Memory Alert", targetType: "SERVER", condition: "HIGH_MEMORY", threshold: 90, isEnabled: true },
        { name: "Server Disk Alert", targetType: "SERVER", condition: "HIGH_DISK", threshold: 90, isEnabled: true }
      ]);
      console.log("[Seeder] AlertRules initialized successfully.");
    }
  } catch (err) {
    console.error("[Seeder] Error seeding AlertRules:", err);
  }
}

module.exports = { initializeAlertRules };
