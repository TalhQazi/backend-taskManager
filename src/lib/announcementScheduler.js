/**
 * Announcement Scheduler Service
 * Handles scheduled announcements, expiration, and recurring announcements
 */

const Announcement = require("../models/Announcement");
const AnnouncementTarget = require("../models/AnnouncementTarget");

/**
 * Publish scheduled announcements that are due
 */
async function publishScheduledAnnouncements() {
  try {
    const now = new Date();
    
    // Find announcements that are scheduled and ready to publish
    const scheduledAnnouncements = await Announcement.find({
      status: "scheduled",
      scheduledAt: { $lte: now },
    });

    console.log(`[Announcement Scheduler] Publishing ${scheduledAnnouncements.length} scheduled announcements`);

    for (const announcement of scheduledAnnouncements) {
      // Update status to active
      await Announcement.findByIdAndUpdate(announcement._id, {
        $set: { status: "active" },
      });

      // Emit socket event for real-time update
      if (global.io) {
        const targets = await AnnouncementTarget.find({
          announcementId: announcement._id,
        }).lean();

        const payload = {
          id: String(announcement._id),
          title: announcement.title,
          priority: announcement.priority,
          emergency: announcement.emergency,
          authorName: announcement.authorName,
          createdAt: announcement.createdAt,
          targetSummary: announcement.targetSummary,
        };

        if (targets.length === 0 || targets.some((t) => t.targetType === "global")) {
          global.io.emit("announcement-published", payload);
        } else {
          targets.forEach((t) => {
            if (t.targetType === "role" && t.targetId) {
              global.io.to(t.targetId).emit("announcement-published", payload);
            } else if (t.targetType === "user" && t.targetId) {
              global.io.to(t.targetId).emit("announcement-published", payload);
            } else {
              global.io.emit("announcement-published", payload);
            }
          });
        }
      }

      console.log(`[Announcement Scheduler] Published announcement: ${announcement._id}`);
    }

    return { published: scheduledAnnouncements.length };
  } catch (err) {
    console.error("[Announcement Scheduler] Error publishing scheduled announcements:", err);
    throw err;
  }
}

/**
 * Expire announcements that have passed their expiration date
 */
async function expireAnnouncements() {
  try {
    const now = new Date();

    // Find announcements that are past expiration
    const expiredAnnouncements = await Announcement.find({
      status: { $in: ["active", "scheduled"] },
      expiresAt: { $lte: now },
    });

    console.log(`[Announcement Scheduler] Expiring ${expiredAnnouncements.length} announcements`);

    for (const announcement of expiredAnnouncements) {
      await Announcement.findByIdAndUpdate(announcement._id, {
        $set: { status: "expired" },
      });

      if (global.io) {
        global.io.emit("announcement-expired", {
          id: String(announcement._id),
        });
      }

      console.log(`[Announcement Scheduler] Expired announcement: ${announcement._id}`);
    }

    return { expired: expiredAnnouncements.length };
  } catch (err) {
    console.error("[Announcement Scheduler] Error expiring announcements:", err);
    throw err;
  }
}

/**
 * Create recurring announcements
 * Announcements with repeatFrequency of "daily" or "weekly" will be republished
 */
async function handleRecurringAnnouncements() {
  try {
    const now = new Date();

    // Find announcements with repeat settings
    const recurringAnnouncements = await Announcement.find({
      repeatFrequency: { $in: ["daily", "weekly"] },
      status: "active",
    });

    console.log(`[Announcement Scheduler] Processing ${recurringAnnouncements.length} recurring announcements`);

    for (const announcement of recurringAnnouncements) {
      let shouldRepeat = false;
      const lastCreatedAt = new Date(announcement.createdAt);

      if (announcement.repeatFrequency === "daily") {
        const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        shouldRepeat = lastCreatedAt < oneDayAgo;
      } else if (announcement.repeatFrequency === "weekly") {
        const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        shouldRepeat = lastCreatedAt < oneWeekAgo;
      }

      if (shouldRepeat) {
        // Reset read/acknowledge counts for new cycle
        // Note: In a real system, you might want to keep old cycles separate
        await Announcement.findByIdAndUpdate(announcement._id, {
          $set: {
            readCount: 0,
            acknowledgedCount: 0,
          },
        });

        if (global.io) {
          global.io.emit("announcement-repeated", {
            id: String(announcement._id),
            title: announcement.title,
            frequency: announcement.repeatFrequency,
          });
        }

        console.log(
          `[Announcement Scheduler] Repeated announcement ${announcement._id} (frequency: ${announcement.repeatFrequency})`
        );
      }
    }

    return { processed: recurringAnnouncements.length };
  } catch (err) {
    console.error("[Announcement Scheduler] Error handling recurring announcements:", err);
    throw err;
  }
}

/**
 * Run all scheduler tasks
 */
async function runAllTasks() {
  try {
    console.log("[Announcement Scheduler] Starting scheduler tasks...");

    const results = await Promise.all([
      publishScheduledAnnouncements(),
      expireAnnouncements(),
      handleRecurringAnnouncements(),
    ]);

    console.log("[Announcement Scheduler] All tasks completed:", results);
    return results;
  } catch (err) {
    console.error("[Announcement Scheduler] Fatal error:", err);
    throw err;
  }
}

module.exports = {
  publishScheduledAnnouncements,
  expireAnnouncements,
  handleRecurringAnnouncements,
  runAllTasks,
};
