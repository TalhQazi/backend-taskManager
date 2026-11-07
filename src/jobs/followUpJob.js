const TaskFollowUp = require("../models/TaskFollowUp");
const FollowUpHistory = require("../models/FollowUpHistory");
const Task = require("../models/Task");
const User = require("../models/User");
const { createNotification } = require("../utils/notifications");

/**
 * Main worker function to execute the follow-up timer cron process.
 * Scans active overdue timers and updates escalation chains.
 * Resumes expired snoozed timers back into action.
 */
async function processFollowUpTimers() {
  const now = new Date();

  try {
    // 1. Scan for active overdue timers
    const overdueTimers = await TaskFollowUp.find({
      status: "active",
      dueAt: { $lte: now },
    });

    for (const timer of overdueTimers) {
      // Transition status to overdue
      timer.status = "overdue";
      await timer.save();

      // Log overdue transition if not logged
      const existsLog = await FollowUpHistory.findOne({
        followUpId: timer._id,
        actionType: "overdue",
      });

      if (!existsLog) {
        await FollowUpHistory.create({
          taskId: timer.taskId,
          followUpId: timer._id,
          userId: "system",
          actionType: "overdue",
          notes: `Follow-up countdown timer breached the due time: ${timer.dueAt.toISOString()}.`,
        });
      }
    }

    // 2. Process all "overdue" timers to calculate and dispatch escalations
    const activeOverdueTimers = await TaskFollowUp.find({ status: "overdue" });

    for (const timer of activeOverdueTimers) {
      const task = await Task.findById(timer.taskId);
      if (!task) continue;

      const dueTime = new Date(timer.dueAt);
      const minutesOverdue = Math.floor((now.getTime() - dueTime.getTime()) / (1000 * 60));

      let targetLevel = 1;
      if (minutesOverdue >= 60) {
        targetLevel = 4;
      } else if (minutesOverdue >= 30) {
        targetLevel = 3;
      } else if (minutesOverdue >= 15) {
        targetLevel = 2;
      }

      // Check if we need to escalate to the targetLevel
      if (timer.escalationLevel < targetLevel) {
        // Run intermediate escalations sequentially up to targetLevel so no level notifications are missed
        for (let lvl = timer.escalationLevel + 1; lvl <= targetLevel; lvl++) {
          await triggerEscalationLevel(timer, task, lvl);
        }
        timer.escalationLevel = targetLevel;
        await timer.save();
      } else if (timer.escalationLevel === 1 && timer.escalationHistory.length === 0) {
        // Trigger Level 1 initially if history is empty
        await triggerEscalationLevel(timer, task, 1);
      }
    }

    // 3. Scan for snoozed timers whose snooze duration has ended
    const expiredSnoozes = await TaskFollowUp.find({
      status: "snoozed",
      snoozedUntil: { $lte: now },
    });

    for (const timer of expiredSnoozes) {
      const oldSnoozeDate = timer.snoozedUntil;
      timer.status = "active";
      timer.dueAt = timer.snoozedUntil; // set new dueAt as the expired snooze target
      timer.snoozedUntil = null;
      await timer.save();

      // Log audit
      await FollowUpHistory.create({
        taskId: timer.taskId,
        followUpId: timer._id,
        userId: "system",
        actionType: "unsnooze",
        notes: `Snooze timer expired at ${oldSnoozeDate.toISOString()}. Follow-up timer has been reactivated.`,
      });

      // Broadcast Socket.io update
      const io = global.io;
      if (io) {
        io.emit("followup-status", {
          taskId: String(timer.taskId),
          followUpId: String(timer._id),
          status: "active",
          dueAt: timer.dueAt.toISOString(),
        });
      }
    }

  } catch (err) {
    console.error("[Follow-Up Cron] Execution failed:", err);
  }
}

/**
 * Triggers a specific escalation level, dispatches notifications, and appends history.
 */
async function triggerEscalationLevel(timer, task, level) {
  const triggeredAt = new Date();
  let notifiedUsers = [];
  let notes = "";

  try {
    if (level === 1) {
      // Level 1: Notify primary assignee
      notifiedUsers = Array.isArray(task.assignees) ? task.assignees : [];
      notes = `Level 1 Escalation: Primary assignees (${notifiedUsers.join(", ")}) notified.`;
    } else if (level === 2) {
      // Level 2: Notify backup user (can be the AI suggested assignee or secondary assignee)
      const backup = timer.aiSuggestions?.suggestedAssignee || (task.assignees[1] ? task.assignees[1] : null);
      if (backup) {
        notifiedUsers = [backup];
      }
      notes = `Level 2 Escalation: Backup user (${notifiedUsers.join(", ") || "none assigned"}) notified.`;
    } else if (level === 3) {
      // Level 3: Notify manager (teamLead mapping or standard manager room)
      const lead = task.teamLead || "manager";
      notifiedUsers = [lead];
      notes = `Level 3 Escalation: Task supervisor/lead (${lead}) notified.`;
    } else if (level === 4) {
      // Level 4: Notify admins
      notifiedUsers = ["admin", "super-admin"];
      notes = "Level 4 Escalation: System administrator alerted of chronic overdue timer.";
    }

    // Add to escalation history array in DB
    timer.escalationHistory.push({
      level,
      triggeredAt,
      notifiedUsers,
    });

    // Write audit log
    await FollowUpHistory.create({
      taskId: timer.taskId,
      followUpId: timer._id,
      userId: "system",
      actionType: "escalate",
      notes: `${notes} Task Title: "${task.title}".`,
    });

    // Create system-wide targeted notification & push trigger
    await createNotification({
      actor: "AI Engine",
      actorRole: "system",
      action: `triggered follow-up timer Escalation Level ${level}`,
      resourceType: "task",
      resourceName: task.title,
      assignees: notifiedUsers,
      details: notes,
      resourceId: String(task._id),
      category: level >= 3 ? "TASK_ASSIGNED" : "MENTIONED", // broadcast widely for higher level escalations
    });

    // Broadcast specialized real-time follow-up update
    const io = global.io;
    if (io) {
      io.emit("followup-escalation", {
        taskId: String(timer.taskId),
        followUpId: String(timer._id),
        level,
        status: "overdue",
        notifiedUsers,
        notes,
      });
    }

    console.log(`[Follow-Up Escalation] Escalated Task "${task.title}" to Level ${level}`);
  } catch (err) {
    console.error(`[Follow-Up Escalation] Failed to trigger Level ${level}:`, err.message);
  }
}

module.exports = { processFollowUpTimers };
