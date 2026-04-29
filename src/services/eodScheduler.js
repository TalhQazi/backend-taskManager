const { runEODTick } = require("./eodEngine");
const { runWeeklyComplianceCheck } = require("./weeklyComplianceReport");

let interval = null;
let weeklyInterval = null;

function startEODScheduler() {
  if (interval) return;
  const enabled = String(process.env.ENABLE_EOD_SCHEDULER || "true").toLowerCase() !== "false";
  if (!enabled) {
    console.log("[EOD Scheduler] Disabled via environment variable");
    return;
  }

  // Run once on start, then every minute
  runEODTick().catch((err) => console.error("[EOD Scheduler] Tick error:", err));
  interval = setInterval(() => {
    runEODTick().catch((err) => console.error("[EOD Scheduler] Tick error:", err));
  }, 60 * 1000);

  interval.unref?.();
  console.log("[EOD Scheduler] Started (tick every 60s)");

  // Weekly compliance report - check every hour (runs actual report on Monday 9 AM)
  runWeeklyComplianceCheck().catch((err) => console.error("[Weekly Compliance] Error:", err));
  weeklyInterval = setInterval(() => {
    runWeeklyComplianceCheck().catch((err) => console.error("[Weekly Compliance] Error:", err));
  }, 60 * 60 * 1000); // Check every hour

  console.log("[Weekly Compliance Scheduler] Started (check every hour, runs Monday 9 AM)");
}

function stopEODScheduler() {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
  if (weeklyInterval) {
    clearInterval(weeklyInterval);
    weeklyInterval = null;
  }
  console.log("[EOD Scheduler] Stopped");
}

module.exports = { startEODScheduler, stopEODScheduler };
