const express = require("express");
const TaskFollowUp = require("../models/TaskFollowUp");
const FollowUpHistory = require("../models/FollowUpHistory");
const Task = require("../models/Task");
const { requireAuth } = require("../middleware/auth");
const { generateAISuggestions } = require("../utils/aiEngine");

const router = express.Router();

// Helper to convert Mongoose document to clean object
function withId(doc) {
  if (!doc) return doc;
  const obj = typeof doc.toObject === "function" ? doc.toObject() : doc;
  return { ...obj, id: String(obj._id) };
}

// 1. GET ALL TIMERS FOR A TASK
router.get("/:taskId/followups", requireAuth, async (req, res, next) => {
  try {
    const { taskId } = req.params;
    const timers = await TaskFollowUp.find({ taskId }).sort({ createdAt: -1 }).lean();
    res.json({ items: timers.map(withId) });
  } catch (err) {
    next(err);
  }
});

// 2. CREATE A NEW TIMER
router.post("/:taskId/followups", requireAuth, async (req, res, next) => {
  try {
    const { taskId } = req.params;
    const { dueAt, slaResponseTime, slaFollowUpInterval, slaCompletionDeadline } = req.body;

    if (!dueAt) {
      return res.status(400).json({ error: { message: "dueAt is required" } });
    }

    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({ error: { message: "Task not found" } });
    }

    // Generate initial AI suggestions for this follow-up immediately
    const aiData = await generateAISuggestions(taskId);

    const timer = await TaskFollowUp.create({
      taskId,
      dueAt: new Date(dueAt),
      createdBy: req.user?.username || req.user?.name || "system",
      status: "active",
      slaResponseTime: slaResponseTime !== undefined ? Number(slaResponseTime) : 15,
      slaFollowUpInterval: slaFollowUpInterval !== undefined ? Number(slaFollowUpInterval) : 30,
      slaCompletionDeadline: slaCompletionDeadline !== undefined ? Number(slaCompletionDeadline) : 60,
      aiSuggestions: aiData,
    });

    // Write audit log
    await FollowUpHistory.create({
      taskId,
      followUpId: timer._id,
      userId: req.user?.username || req.user?.name || "system",
      actionType: "create",
      notes: `Created new follow-up timer scheduled for ${new Date(dueAt).toISOString()}.`,
    });

    res.status(201).json({ item: withId(timer) });
  } catch (err) {
    next(err);
  }
});

// 3. EDIT A TIMER (dueAt & SLA thresholds)
router.put("/:taskId/followups/:id", requireAuth, async (req, res, next) => {
  try {
    const { taskId, id } = req.params;
    const { dueAt, slaResponseTime, slaFollowUpInterval, slaCompletionDeadline } = req.body;

    const timer = await TaskFollowUp.findOne({ _id: id, taskId });
    if (!timer) {
      return res.status(404).json({ error: { message: "Follow-up timer not found" } });
    }

    const oldDueAt = timer.dueAt;
    if (dueAt) timer.dueAt = new Date(dueAt);
    if (slaResponseTime !== undefined) timer.slaResponseTime = Number(slaResponseTime);
    if (slaFollowUpInterval !== undefined) timer.slaFollowUpInterval = Number(slaFollowUpInterval);
    if (slaCompletionDeadline !== undefined) timer.slaCompletionDeadline = Number(slaCompletionDeadline);

    // Reset status to active if updated due date is in the future
    if (timer.status === "overdue" && new Date(timer.dueAt) > new Date()) {
      timer.status = "active";
      timer.escalationLevel = 1;
      timer.escalationHistory = [];
    }

    await timer.save();

    // Write audit log
    await FollowUpHistory.create({
      taskId,
      followUpId: timer._id,
      userId: req.user?.username || req.user?.name || "system",
      actionType: "edit",
      notes: `Updated due date from ${oldDueAt.toISOString()} to ${new Date(timer.dueAt).toISOString()}.`,
    });

    res.json({ item: withId(timer) });
  } catch (err) {
    next(err);
  }
});

// 4. COMPLETE A TIMER (Resolves SLA status)
router.patch("/:taskId/followups/:id/complete", requireAuth, async (req, res, next) => {
  try {
    const { taskId, id } = req.params;

    const timer = await TaskFollowUp.findOne({ _id: id, taskId });
    if (!timer) {
      return res.status(404).json({ error: { message: "Follow-up timer not found" } });
    }

    const now = new Date();
    timer.status = "completed";
    timer.completedAt = now;
    
    // Resolve SLA Status
    if (now <= timer.dueAt) {
      timer.slaStatus = "Resolved On Time";
    } else {
      timer.slaStatus = "Resolved Late";
    }

    await timer.save();

    // Write audit log
    await FollowUpHistory.create({
      taskId,
      followUpId: timer._id,
      userId: req.user?.username || req.user?.name || "system",
      actionType: "complete",
      notes: `Completed follow-up timer at ${now.toISOString()}. SLA Status resolved as "${timer.slaStatus}".`,
    });

    // Broadcast update
    const io = global.io;
    if (io) {
      io.emit("followup-status", {
        taskId,
        followUpId: id,
        status: "completed",
        slaStatus: timer.slaStatus,
        completedAt: now.toISOString(),
      });
    }

    res.json({ item: withId(timer) });
  } catch (err) {
    next(err);
  }
});

// 5. SNOOZE A TIMER
router.patch("/:taskId/followups/:id/snooze", requireAuth, async (req, res, next) => {
  try {
    const { taskId, id } = req.params;
    const { minutes } = req.body; // Snooze duration in minutes

    const snoozeMins = minutes ? Number(minutes) : 15;

    const timer = await TaskFollowUp.findOne({ _id: id, taskId });
    if (!timer) {
      return res.status(404).json({ error: { message: "Follow-up timer not found" } });
    }

    const snoozeUntil = new Date(Date.now() + snoozeMins * 60 * 1000);
    timer.status = "snoozed";
    timer.snoozedUntil = snoozeUntil;
    timer.slaStatus = "Warning"; // mark warning for snoozing/delaying task

    await timer.save();

    // Write audit log
    await FollowUpHistory.create({
      taskId,
      followUpId: timer._id,
      userId: req.user?.username || req.user?.name || "system",
      actionType: "snooze",
      notes: `Snoozed follow-up timer for ${snoozeMins} minutes until ${snoozeUntil.toISOString()}.`,
    });

    // Broadcast update
    const io = global.io;
    if (io) {
      io.emit("followup-status", {
        taskId,
        followUpId: id,
        status: "snoozed",
        snoozedUntil: snoozeUntil.toISOString(),
      });
    }

    res.json({ item: withId(timer) });
  } catch (err) {
    next(err);
  }
});

// 6. RESET A TIMER (Resets status to active and escalations to lvl 1)
router.patch("/:taskId/followups/:id/reset", requireAuth, async (req, res, next) => {
  try {
    const { taskId, id } = req.params;
    const { dueAt } = req.body; // new due time optional

    const timer = await TaskFollowUp.findOne({ _id: id, taskId });
    if (!timer) {
      return res.status(404).json({ error: { message: "Follow-up timer not found" } });
    }

    // Default reset due time to 30 minutes in the future if none provided
    const nextDue = dueAt ? new Date(dueAt) : new Date(Date.now() + 30 * 60 * 1000);

    timer.status = "active";
    timer.dueAt = nextDue;
    timer.completedAt = null;
    timer.snoozedUntil = null;
    timer.escalationLevel = 1;
    timer.escalationHistory = [];
    timer.slaStatus = "On Track";

    await timer.save();

    // Write audit log
    await FollowUpHistory.create({
      taskId,
      followUpId: timer._id,
      userId: req.user?.username || req.user?.name || "system",
      actionType: "reset",
      notes: `Reset follow-up timer. New countdown due at ${nextDue.toISOString()}. Escalation level reset to 1.`,
    });

    // Broadcast update
    const io = global.io;
    if (io) {
      io.emit("followup-status", {
        taskId,
        followUpId: id,
        status: "active",
        dueAt: nextDue.toISOString(),
      });
    }

    res.json({ item: withId(timer) });
  } catch (err) {
    next(err);
  }
});

// 7. GET AI SUGGESTIONS
router.get("/:taskId/followups/:id/ai-suggestions", requireAuth, async (req, res, next) => {
  try {
    const { taskId, id } = req.params;

    const timer = await TaskFollowUp.findOne({ _id: id, taskId });
    if (!timer) {
      return res.status(404).json({ error: { message: "Follow-up timer not found" } });
    }

    // Generate fresh predictions
    const suggestions = await generateAISuggestions(taskId);
    timer.aiSuggestions = suggestions;
    await timer.save();

    res.json({ suggestions });
  } catch (err) {
    next(err);
  }
});

// 8. APPROVE AI SUGGESTIONS AND APPLY
router.post("/:taskId/followups/:id/ai-approve", requireAuth, async (req, res, next) => {
  try {
    const { taskId, id } = req.params;

    const timer = await TaskFollowUp.findOne({ _id: id, taskId });
    if (!timer) {
      return res.status(404).json({ error: { message: "Follow-up timer not found" } });
    }

    const suggestions = timer.aiSuggestions;
    if (!suggestions || !suggestions.suggestedInterval) {
      return res.status(400).json({ error: { message: "No suggestions generated yet. Run suggestions query first." } });
    }

    const oldDue = timer.dueAt;
    // Apply suggested interval to set new dueAt
    const intervalMins = suggestions.suggestedInterval;
    timer.dueAt = new Date(Date.now() + intervalMins * 60 * 1000);
    timer.status = "active";
    timer.escalationLevel = 1;
    timer.escalationHistory = [];
    timer.slaStatus = "On Track";

    await timer.save();

    // Write audit log
    await FollowUpHistory.create({
      taskId,
      followUpId: timer._id,
      userId: req.user?.username || req.user?.name || "system",
      actionType: "ai-approve",
      notes: `Approved and applied AI Recommendations. Reset timer interval to suggested ${intervalMins} minutes (due: ${timer.dueAt.toISOString()}).`,
    });

    res.json({ item: withId(timer) });
  } catch (err) {
    next(err);
  }
});

// 9. GET AUDIT LOG HISTORY FOR A TASK
router.get("/:taskId/followups/history", requireAuth, async (req, res, next) => {
  try {
    const { taskId } = req.params;
    const history = await FollowUpHistory.find({ taskId }).sort({ timestamp: -1 }).lean();
    res.json({ items: history.map(withId) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
