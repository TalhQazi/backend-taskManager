const express = require("express");
const { z } = require("zod");
const mongoose = require("mongoose");
const Meeting = require("../models/Meeting");
const { requireAuth } = require("../middleware/auth");
const { sendEmailNotification } = require("../utils/emailNotifications");
const { sendRawEmail } = require("../lib/email");

const router = express.Router();

function generateRoomCode() {
  const segment = () => Math.floor(100 + Math.random() * 900).toString();
  return `${segment()}-${segment()}-${segment()}`;
}

function withId(doc) {
  if (!doc) return doc;
  const obj = doc.toObject ? doc.toObject() : doc;
  const { __v, ...rest } = obj;
  return { ...rest, id: String(doc._id) };
}

function formatMeetingTime(date, timeZone) {
  if (!date) return "TBD";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || "UTC",
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date(date));
  } catch {
    return new Date(date).toUTCString();
  }
}

function getAppBaseUrl(req) {
  const fromEnv = (process.env.CORS_ORIGIN || "").split(",")[0]?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const origin = req.get("origin");
  if (origin) return origin.replace(/\/$/, "");
  return "http://localhost:8080";
}

async function sendMeetingInviteEmails({ meeting, req }) {
  const participants = Array.isArray(meeting.invitedParticipants) ? meeting.invitedParticipants : [];
  if (!participants.length) return { sent: 0, failed: 0 };

  const baseUrl = getAppBaseUrl(req);
  const meetingTime = formatMeetingTime(meeting.scheduledStartTime, meeting.timezone);
  let sent = 0;
  let failed = 0;

  await Promise.all(
    participants.map(async (p) => {
      const email = String(p.email || "").trim();
      if (!email) {
        failed += 1;
        return;
      }

      const role = String(p.role || "employee").toLowerCase();
      // Always use role-agnostic join URL so managers/admins/employees all land in the right panel
      const joinLink = `${baseUrl}/join/meeting/${meeting.roomCode}`;

      const variables = {
        name: p.name || "Team Member",
        meetingTitle: meeting.title || "Team Meeting",
        meetingTime,
        timezone: meeting.timezone || "UTC",
        duration: String(meeting.durationMinutes || 30),
        hostName: meeting.hostName || "Host",
        roomCode: meeting.roomCode,
        agenda: meeting.description || "No agenda provided.",
        joinLink,
        role,
      };

      try {
        const result = await sendEmailNotification(email, "meetingInvite", variables);
        if (result === true || result?.sent === true) {
          sent += 1;
          return;
        }

        // Fallback raw email if template path fails
        const subject = `Meeting Invite: ${variables.meetingTitle}`;
        const body = `Hello ${variables.name},\n\nYou have been invited to a video meeting.\n\nTopic: ${variables.meetingTitle}\nWhen: ${variables.meetingTime}\nTimezone: ${variables.timezone}\nDuration: ${variables.duration} minutes\nHost: ${variables.hostName}\nRoom Code: ${variables.roomCode}\n\nAgenda:\n${variables.agenda}\n\nJoin link:\n${variables.joinLink}\n\nBest regards,\nTask Manager System`;
        const rawOk = await sendRawEmail({ to: email, subject, body });
        if (rawOk) sent += 1;
        else failed += 1;
      } catch (err) {
        console.error("Meeting invite email failed:", err);
        failed += 1;
      }
    })
  );

  return { sent, failed };
}

const participantSchema = z.object({
  userId: z.string().optional().default(""),
  name: z.string().optional().default(""),
  email: z.string().optional().default(""),
  role: z.string().optional().default("employee"),
});

const createMeetingSchema = z.object({
  title: z.string().min(1).default("Quick Meeting"),
  description: z.string().optional().default(""),
  meetingType: z.enum(["instant", "scheduled"]).default("instant"),
  scheduledStartTime: z.string().optional().nullable(),
  timezone: z.string().optional().default("UTC"),
  durationMinutes: z.number().min(5).max(480).default(30),
  invitedParticipants: z.array(participantSchema).optional().default([]),
  taskId: z.string().optional().nullable(),
  passcode: z.string().optional().default(""),
});

const updateMeetingSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  scheduledStartTime: z.string().optional().nullable(),
  timezone: z.string().optional(),
  durationMinutes: z.number().min(5).max(480).optional(),
  invitedParticipants: z.array(participantSchema).optional(),
  status: z.enum(["scheduled", "active", "ended"]).optional(),
  passcode: z.string().optional(),
});

// GET /api/meetings - list meetings
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const { type, taskId, q } = req.query;
    const filter = {};

    if (taskId && mongoose.Types.ObjectId.isValid(taskId)) {
      filter.taskId = new mongoose.Types.ObjectId(taskId);
    }

    if (type === "active") {
      filter.status = "active";
    } else if (type === "upcoming") {
      filter.status = { $in: ["scheduled", "active"] };
    } else if (type === "past") {
      filter.status = "ended";
    }

    if (q && typeof q === "string") {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ title: rx }, { description: rx }, { roomCode: rx }, { hostName: rx }];
    }

    // Role-based visibility: employees see meetings they host, are invited to, or instant public rooms
    const isPrivileged = ["super-admin", "admin", "manager"].includes(req.user?.role);
    const userId = String(req.user?.sub || req.user?.id || "");
    const userEmail = String(req.user?.username || req.user?.email || "").toLowerCase();

    if (!isPrivileged && userId) {
      filter.$or = [
        { hostId: userId },
        { "invitedParticipants.userId": userId },
        { "invitedParticipants.email": userEmail },
        { meetingType: "instant", status: "active" },
      ];
    }

    const sort = type === "past" ? { endedAt: -1, createdAt: -1 } : { scheduledStartTime: 1, createdAt: -1 };
    const items = await Meeting.find(filter).sort(sort).limit(100).lean();

    res.json({ items: items.map(withId) });
  } catch (err) {
    next(err);
  }
});

// GET /api/meetings/code/:code - lookup by room code
router.get("/code/:code", requireAuth, async (req, res, next) => {
  try {
    const cleanCode = String(req.params.code || "").trim();
    if (!cleanCode) {
      return res.status(400).json({ error: { message: "Invalid room code" } });
    }

    let meeting = await Meeting.findOne({ roomCode: cleanCode }).lean();

    if (!meeting) {
      // Create ad-hoc instant meeting if valid room code format
      const hostId = String(req.user?.sub || req.user?.id || "guest");
      const hostName = String(req.user?.name || "Host");
      const hostEmail = String(req.user?.username || "");
      const hostRole = String(req.user?.role || "employee");

      const created = await Meeting.create({
        roomCode: cleanCode,
        title: `Room ${cleanCode}`,
        meetingType: "instant",
        hostId,
        hostName,
        hostEmail,
        hostRole,
        status: "active",
      });

      return res.json({ item: withId(created) });
    }

    res.json({ item: withId(meeting) });
  } catch (err) {
    next(err);
  }
});

// GET /api/meetings/:id - get single meeting
router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: { message: "Invalid meeting id" } });
    }

    const meeting = await Meeting.findById(req.params.id).lean();
    if (!meeting) {
      return res.status(404).json({ error: { message: "Meeting not found" } });
    }

    res.json({ item: withId(meeting) });
  } catch (err) {
    next(err);
  }
});

// POST /api/meetings - create instant or scheduled meeting
router.post("/", requireAuth, async (req, res, next) => {
  try {
    const parsed = createMeetingSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: parsed.error.issues[0]?.message || "Invalid payload" } });
    }

    const data = parsed.data;
    const roomCode = generateRoomCode();

    const hostId = String(req.user?.sub || req.user?.id || "");
    const hostName = String(req.user?.name || "Host");
    const hostEmail = String(req.user?.username || "");
    const hostRole = String(req.user?.role || "admin");

    const status = data.meetingType === "scheduled" && data.scheduledStartTime ? "scheduled" : "active";
    const scheduledStartTime = data.scheduledStartTime ? new Date(data.scheduledStartTime) : null;
    const taskId = data.taskId && mongoose.Types.ObjectId.isValid(data.taskId) ? new mongoose.Types.ObjectId(data.taskId) : null;

    const doc = await Meeting.create({
      roomCode,
      title: data.title,
      description: data.description,
      meetingType: data.meetingType,
      scheduledStartTime,
      timezone: data.timezone || "UTC",
      durationMinutes: data.durationMinutes,
      hostId,
      hostName,
      hostEmail,
      hostRole,
      invitedParticipants: data.invitedParticipants,
      taskId,
      status,
      passcode: data.passcode,
      startedAt: status === "active" ? new Date() : null,
    });

    let emailResult = { sent: 0, failed: 0 };
    if (data.meetingType === "scheduled" && Array.isArray(data.invitedParticipants) && data.invitedParticipants.length > 0) {
      emailResult = await sendMeetingInviteEmails({ meeting: doc, req });
    }

    res.status(201).json({ item: withId(doc), emailResult });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/meetings/:id - update meeting
router.patch("/:id", requireAuth, async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: { message: "Invalid meeting id" } });
    }

    const parsed = updateMeetingSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: parsed.error.issues[0]?.message || "Invalid payload" } });
    }

    const meeting = await Meeting.findById(req.params.id);
    if (!meeting) {
      return res.status(404).json({ error: { message: "Meeting not found" } });
    }

    const userId = String(req.user?.sub || req.user?.id || "");
    const isPrivileged = ["super-admin", "admin", "manager"].includes(req.user?.role);
    if (!isPrivileged && meeting.hostId !== userId) {
      return res.status(403).json({ error: { message: "Only the host can modify this meeting" } });
    }

    Object.assign(meeting, parsed.data);
    if (parsed.data.scheduledStartTime) {
      meeting.scheduledStartTime = new Date(parsed.data.scheduledStartTime);
    }
    await meeting.save();

    res.json({ item: withId(meeting) });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/meetings/:id - cancel/delete meeting
router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: { message: "Invalid meeting id" } });
    }

    const meeting = await Meeting.findById(req.params.id);
    if (!meeting) {
      return res.status(404).json({ error: { message: "Meeting not found" } });
    }

    const userId = String(req.user?.sub || req.user?.id || "");
    const isPrivileged = ["super-admin", "admin", "manager"].includes(req.user?.role);
    if (!isPrivileged && meeting.hostId !== userId) {
      return res.status(403).json({ error: { message: "Only the host can delete this meeting" } });
    }

    await Meeting.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/meetings/:id/end - end meeting
router.post("/:id/end", requireAuth, async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: { message: "Invalid meeting id" } });
    }

    const meeting = await Meeting.findById(req.params.id);
    if (!meeting) {
      return res.status(404).json({ error: { message: "Meeting not found" } });
    }

    meeting.status = "ended";
    meeting.endedAt = new Date();
    await meeting.save();

    res.json({ item: withId(meeting) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
