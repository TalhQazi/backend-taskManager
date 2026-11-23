const express = require("express");
const mongoose = require("mongoose");
const { z } = require("zod");
const { requireAuth } = require("../middleware/auth");
const Poll = require("../models/Poll");
const PollOption = require("../models/PollOption");
const PollVote = require("../models/PollVote");
const PollComment = require("../models/PollComment");
const PollAudience = require("../models/PollAudience");
const PollNotification = require("../models/PollNotification");
const PollDecision = require("../models/PollDecision");
const PollAuditLog = require("../models/PollAuditLog");
const Employee = require("../models/Employee");
const { createNotification } = require("../utils/notifications");
const { sendEmailNotification } = require("../utils/emailNotifications");

const router = express.Router();

const POLL_TYPES = ["yes_no", "multiple_choice", "rating_1_10", "star_rating", "open_feedback"];
const POLL_STATUSES = ["draft", "scheduled", "active", "closed", "implemented", "rejected", "archived"];

function getActor(req) {
  return {
    id: String(req.user?.sub || req.user?.id || ""),
    name: String(req.user?.name || req.user?.username || "Unknown"),
    role: String(req.user?.role || "").toLowerCase().trim(),
    email: String(req.user?.email || ""),
  };
}

function isAdmin(role) {
  const r = String(role || "").toLowerCase().trim();
  return r === "super-admin" || r === "admin";
}

function canCreate(role) {
  const r = String(role || "").toLowerCase().trim();
  return isAdmin(r) || r === "manager" || r === "team-lead";
}

function canDecide(role) {
  return isAdmin(role);
}

async function writeAudit(pollId, actor, action, meta = {}) {
  try {
    await PollAuditLog.create({
      pollId,
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      action,
      meta,
    });
  } catch (err) {
    console.error("[polls] audit log failed:", err.message);
  }
}

async function loadEmployeeForUser(req) {
  const actor = getActor(req);
  const conditions = [];
  if (mongoose.Types.ObjectId.isValid(actor.id)) conditions.push({ _id: actor.id });
  if (actor.email) conditions.push({ email: new RegExp(`^${escapeRegExp(actor.email)}$`, "i") });
  if (actor.name) conditions.push({ name: new RegExp(`^${escapeRegExp(actor.name)}$`, "i") });
  if (req.user?.username) conditions.push({ email: new RegExp(`^${escapeRegExp(req.user.username)}$`, "i") });
  if (!conditions.length) return null;
  return Employee.findOne({ $or: conditions })
    .select("_id name email company department location locationId userRole role team status")
    .lean();
}

function escapeRegExp(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function employeeMatchesAudience(emp, audiences) {
  if (!audiences || audiences.length === 0) return true;
  const empId = String(emp?._id || "").toLowerCase();
  const empEmail = String(emp?.email || "").toLowerCase();
  const empName = String(emp?.name || "").toLowerCase();
  const empRole = String(emp?.userRole || emp?.role || "").toLowerCase();
  const empDept = String(emp?.department || "").toLowerCase();
  const empLoc = String(emp?.location || "").toLowerCase();
  const empLocId = String(emp?.locationId || "").toLowerCase();
  const empCompany = String(emp?.company || "").toLowerCase();

  for (const t of audiences) {
    const type = String(t.targetType || "").toLowerCase();
    const id = String(t.targetId || "").toLowerCase().trim();
    if (type === "global") return true;
    if (type === "company" && (!id || id === empCompany || id === "all")) return true;
    if (type === "department" && id && id === empDept) return true;
    if (type === "location" && id && (id === empLoc || id === empLocId)) return true;
    if (type === "role" && id && id === empRole) return true;
    if (type === "user" && id && (id === empId || id === empEmail || id === empName)) return true;
  }
  return false;
}

async function isUserEligible(req, poll, audiences) {
  const role = String(req.user?.role || "").toLowerCase();
  if (isAdmin(role)) {
    return poll.status !== "draft" || String(poll.creatorId) === String(req.user?.sub || "");
  }
  if (String(poll.creatorId) === String(req.user?.sub || req.user?.id || "")) return true;
  if (["draft"].includes(poll.status) && !isAdmin(role)) return false;
  const emp = await loadEmployeeForUser(req);
  return employeeMatchesAudience(emp, audiences);
}

async function resolveAudienceEmployees(audiences) {
  if (!audiences || audiences.length === 0 || audiences.some((a) => a.targetType === "global")) {
    return Employee.find({ status: { $ne: "inactive" }, userStatus: { $ne: "inactive" } })
      .select("_id name email company department location locationId userRole role")
      .lean();
  }

  const or = [];
  for (const t of audiences) {
    const type = String(t.targetType || "").toLowerCase();
    const id = String(t.targetId || "").trim();
    if (type === "company" && id) or.push({ company: new RegExp(`^${escapeRegExp(id)}$`, "i") });
    if (type === "department" && id) or.push({ department: new RegExp(`^${escapeRegExp(id)}$`, "i") });
    if (type === "location" && id) {
      or.push({ location: new RegExp(`^${escapeRegExp(id)}$`, "i") });
      if (mongoose.Types.ObjectId.isValid(id)) or.push({ locationId: id });
    }
    if (type === "role" && id) or.push({ userRole: new RegExp(`^${escapeRegExp(id)}$`, "i") });
    if (type === "user" && id) {
      or.push({ email: new RegExp(`^${escapeRegExp(id)}$`, "i") });
      or.push({ name: new RegExp(`^${escapeRegExp(id)}$`, "i") });
      if (mongoose.Types.ObjectId.isValid(id)) or.push({ _id: id });
    }
  }

  if (!or.length) {
    return Employee.find({ status: { $ne: "inactive" } }).select("_id name email").lean();
  }

  return Employee.find({
    status: { $ne: "inactive" },
    userStatus: { $ne: "inactive" },
    $or: or,
  })
    .select("_id name email company department location locationId userRole role")
    .lean();
}

function withId(doc) {
  if (!doc) return doc;
  const o = typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
  o.id = String(o._id);
  return o;
}

function buildTargetSummary(audiences) {
  if (!audiences || audiences.length === 0) return "Everyone";
  if (audiences.some((a) => a.targetType === "global")) return "Everyone";
  return audiences.map((a) => a.targetLabel || a.targetId || a.targetType).filter(Boolean).join(", ") || "Custom audience";
}

async function replaceOptions(pollId, options = []) {
  await PollOption.deleteMany({ pollId });
  if (!Array.isArray(options) || options.length === 0) return [];
  const docs = options
    .filter((o) => o && String(o.label || "").trim())
    .map((o, idx) => ({
      pollId,
      label: String(o.label).trim(),
      imageUrl: o.imageUrl || "",
      sortOrder: typeof o.sortOrder === "number" ? o.sortOrder : idx,
    }));
  if (!docs.length) return [];
  return PollOption.insertMany(docs);
}

async function replaceAudiences(pollId, audiences = []) {
  await PollAudience.deleteMany({ pollId });
  if (!Array.isArray(audiences) || audiences.length === 0) {
    return PollAudience.create({ pollId, targetType: "global", targetId: "", targetLabel: "Everyone" });
  }
  const docs = audiences.map((a) => ({
    pollId,
    targetType: a.targetType || "global",
    targetId: a.targetId || "",
    targetLabel: a.targetLabel || a.targetId || a.targetType || "",
  }));
  return PollAudience.insertMany(docs);
}

async function computeResults(poll, options) {
  const votes = await PollVote.find({ pollId: poll._id }).lean();
  const base = {
    voteCount: votes.length,
    audienceCount: poll.audienceCount || 0,
    participationRate:
      poll.audienceCount > 0 ? Math.round((votes.length / poll.audienceCount) * 1000) / 10 : 0,
  };

  if (poll.type === "yes_no" || poll.type === "multiple_choice") {
    const counts = {};
    for (const opt of options) counts[String(opt._id)] = { optionId: String(opt._id), label: opt.label, count: 0 };
    for (const v of votes) {
      for (const oid of v.optionIds || []) {
        const key = String(oid);
        if (counts[key]) counts[key].count += 1;
      }
    }
    return { ...base, options: Object.values(counts) };
  }

  if (poll.type === "rating_1_10" || poll.type === "star_rating") {
    const ratings = votes.map((v) => Number(v.rating)).filter((n) => Number.isFinite(n));
    const avg = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;
    const distribution = {};
    const max = poll.type === "star_rating" ? 5 : 10;
    for (let i = 1; i <= max; i++) distribution[i] = 0;
    ratings.forEach((r) => {
      const k = Math.round(r);
      if (distribution[k] !== undefined) distribution[k] += 1;
    });
    return { ...base, average: Math.round(avg * 100) / 100, distribution };
  }

  return {
    ...base,
    responses: votes
      .filter((v) => v.textAnswer)
      .map((v) => ({ userName: v.userName, text: v.textAnswer, createdAt: v.createdAt })),
  };
}

async function fanOutPublishNotifications(poll, audiences, actor) {
  const employees = await resolveAudienceEmployees(audiences);
  const audienceCount = employees.length;
  await Poll.updateOne({ _id: poll._id }, { $set: { audienceCount } });

  const assigneeTokens = employees
    .flatMap((e) => [e.email, e.name, String(e._id)])
    .filter(Boolean);

  if (poll.sendInApp !== false) {
    try {
      await createNotification({
        actor: actor.name,
        actorRole: actor.role,
        action: "published poll",
        resourceType: "poll",
        resourceName: poll.title,
        assignees: assigneeTokens,
        resourceId: String(poll._id),
        details: poll.targetSummary || "",
        category: "POLL_ASSIGNED",
        link: `/employee/polls`,
      });
      for (const emp of employees) {
        await PollNotification.create({
          pollId: poll._id,
          userId: String(emp._id),
          userEmail: emp.email || "",
          channel: "in_app",
          status: "sent",
          sentAt: new Date(),
        }).catch(() => {});
      }
    } catch (err) {
      console.error("[polls] in-app notify failed:", err.message);
    }
  }

  if (poll.sendEmail) {
    for (const emp of employees) {
      const target = emp.email || emp.name;
      if (!target) continue;
      try {
        const result = await sendEmailNotification(target, "pollAssignment", {
          name: emp.name || "Team Member",
          pollTitle: poll.title,
          pollDescription: poll.description || "",
          closesAt: poll.closesAt ? new Date(poll.closesAt).toLocaleString() : "No deadline",
        });
        await PollNotification.create({
          pollId: poll._id,
          userId: String(emp._id),
          userEmail: emp.email || "",
          channel: "email",
          status: result && result.sent !== false ? "sent" : "failed",
          sentAt: new Date(),
          error: result && result.sent === false ? String(result.reason || "") : "",
        }).catch(() => {});
      } catch (err) {
        await PollNotification.create({
          pollId: poll._id,
          userId: String(emp._id),
          userEmail: emp.email || "",
          channel: "email",
          status: "failed",
          error: err.message,
        }).catch(() => {});
      }
    }
  }

  return audienceCount;
}

const createSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().default(""),
  type: z.enum(POLL_TYPES),
  status: z.enum(POLL_STATUSES).optional(),
  scheduledAt: z.string().nullable().optional(),
  closesAt: z.string().nullable().optional(),
  allowEditUntilDeadline: z.boolean().optional().default(true),
  allowComments: z.boolean().optional().default(true),
  allowMultipleOptions: z.boolean().optional().default(false),
  showResultsBeforeClose: z.boolean().optional().default(false),
  sendInApp: z.boolean().optional().default(true),
  sendEmail: z.boolean().optional().default(true),
  sendPush: z.boolean().optional().default(false),
  sendSms: z.boolean().optional().default(false),
  options: z
    .array(z.object({ label: z.string(), imageUrl: z.string().optional(), sortOrder: z.number().optional() }))
    .optional()
    .default([]),
  audiences: z
    .array(
      z.object({
        targetType: z.enum(["global", "company", "department", "location", "role", "user"]),
        targetId: z.string().optional().default(""),
        targetLabel: z.string().optional().default(""),
      })
    )
    .optional()
    .default([]),
  attachments: z
    .array(
      z.object({
        fileName: z.string().optional(),
        url: z.string().optional(),
        mimeType: z.string().optional(),
        size: z.number().optional(),
      })
    )
    .optional()
    .default([]),
  publishNow: z.boolean().optional().default(false),
});

// GET /dashboard — must be before /:id
router.get("/dashboard", requireAuth, async (req, res, next) => {
  try {
    const actor = getActor(req);
    const emp = await loadEmployeeForUser(req);
    const all = await Poll.find({ status: { $ne: "archived" } }).sort({ createdAt: -1 }).limit(500).lean();
    const pollIds = all.map((p) => p._id);
    const audiences = await PollAudience.find({ pollId: { $in: pollIds } }).lean();
    const byPoll = {};
    for (const a of audiences) {
      const k = String(a.pollId);
      if (!byPoll[k]) byPoll[k] = [];
      byPoll[k].push(a);
    }

    const visible = [];
    for (const p of all) {
      if (isAdmin(actor.role) || String(p.creatorId) === actor.id) {
        visible.push(p);
        continue;
      }
      if (employeeMatchesAudience(emp, byPoll[String(p._id)] || []) && p.status !== "draft") {
        visible.push(p);
      }
    }

    const active = visible.filter((p) => p.status === "active").length;
    const closed = visible.filter((p) => ["closed", "implemented", "rejected"].includes(p.status)).length;
    const votes = await PollVote.countDocuments({ pollId: { $in: visible.map((p) => p._id) } });
    const audienceTotal = visible.reduce((s, p) => s + (p.audienceCount || 0), 0);
    const participationRate = audienceTotal > 0 ? Math.round((votes / audienceTotal) * 1000) / 10 : 0;

    let pendingVotes = 0;
    if (emp) {
      const activePolls = visible.filter((p) => p.status === "active");
      const myVotes = await PollVote.find({
        pollId: { $in: activePolls.map((p) => p._id) },
        userId: String(emp._id),
      })
        .select("pollId")
        .lean();
      const votedSet = new Set(myVotes.map((v) => String(v.pollId)));
      pendingVotes = activePolls.filter((p) => !votedSet.has(String(p._id))).length;
    }

    const decisions = await PollDecision.find({})
      .sort({ decidedAt: -1 })
      .limit(8)
      .lean();
    const decisionPollIds = decisions.map((d) => d.pollId);
    const decisionPolls = await Poll.find({ _id: { $in: decisionPollIds } }).select("title status").lean();
    const pollTitleMap = Object.fromEntries(decisionPolls.map((p) => [String(p._id), p.title]));

    res.json({
      item: {
        activePolls: active,
        closedPolls: closed,
        participationRate,
        pendingVotes,
        recentDecisions: decisions.map((d) => ({
          ...withId(d),
          pollTitle: pollTitleMap[String(d.pollId)] || "",
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const actor = getActor(req);
    const status = String(req.query.status || "").trim();
    const search = String(req.query.search || "").trim();
    const match = {};
    if (status && status !== "all") match.status = status;
    else match.status = { $ne: "archived" };
    if (search) match.$text = { $search: search };

    const polls = await Poll.find(match).sort({ createdAt: -1 }).limit(300).lean();
    const pollIds = polls.map((p) => p._id);
    const [audiences, options, myVotes] = await Promise.all([
      PollAudience.find({ pollId: { $in: pollIds } }).lean(),
      PollOption.find({ pollId: { $in: pollIds } }).sort({ sortOrder: 1 }).lean(),
      PollVote.find({
        pollId: { $in: pollIds },
        userId: { $in: [actor.id, String((await loadEmployeeForUser(req))?._id || "")] },
      }).lean(),
    ]);

    const audBy = {};
    const optBy = {};
    const voteBy = {};
    for (const a of audiences) {
      const k = String(a.pollId);
      if (!audBy[k]) audBy[k] = [];
      audBy[k].push(withId(a));
    }
    for (const o of options) {
      const k = String(o.pollId);
      if (!optBy[k]) optBy[k] = [];
      optBy[k].push(withId(o));
    }
    for (const v of myVotes) voteBy[String(v.pollId)] = withId(v);

    const emp = await loadEmployeeForUser(req);
    const items = [];
    for (const p of polls) {
      const aud = audBy[String(p._id)] || [];
      const eligible =
        isAdmin(actor.role) ||
        String(p.creatorId) === actor.id ||
        (p.status !== "draft" && employeeMatchesAudience(emp, aud));
      if (!eligible) continue;
      items.push({
        ...withId(p),
        audiences: aud,
        options: optBy[String(p._id)] || [],
        myVote: voteBy[String(p._id)] || null,
        hasVoted: Boolean(voteBy[String(p._id)]),
      });
    }

    res.json({ items, total: items.length });
  } catch (err) {
    next(err);
  }
});

// POST /
router.post("/", requireAuth, async (req, res, next) => {
  try {
    const actor = getActor(req);
    if (!canCreate(actor.role)) {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }
    const parsed = createSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload", details: parsed.error.errors } });
    }
    const data = parsed.data;

    // Default options for yes/no
    let options = data.options || [];
    if (data.type === "yes_no" && options.length === 0) {
      options = [{ label: "Yes", sortOrder: 0 }, { label: "No", sortOrder: 1 }];
    }
    if ((data.type === "multiple_choice" || data.type === "yes_no") && options.length < 2) {
      return res.status(400).json({ error: { message: "At least 2 options are required" } });
    }

    let status = data.status || "draft";
    if (data.publishNow) status = "active";
    else if (data.scheduledAt && new Date(data.scheduledAt) > new Date()) status = "scheduled";

    const audiences = data.audiences?.length
      ? data.audiences
      : [{ targetType: "global", targetId: "", targetLabel: "Everyone" }];

    const poll = await Poll.create({
      title: data.title.trim(),
      description: data.description || "",
      type: data.type,
      status,
      scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
      closesAt: data.closesAt ? new Date(data.closesAt) : null,
      allowEditUntilDeadline: data.allowEditUntilDeadline !== false,
      allowComments: data.allowComments !== false,
      allowMultipleOptions: Boolean(data.allowMultipleOptions),
      showResultsBeforeClose: Boolean(data.showResultsBeforeClose),
      creatorId: actor.id,
      creatorName: actor.name,
      creatorRole: actor.role,
      targetSummary: buildTargetSummary(audiences),
      sendInApp: data.sendInApp !== false,
      sendEmail: data.sendEmail !== false,
      sendPush: Boolean(data.sendPush),
      sendSms: Boolean(data.sendSms),
      attachments: data.attachments || [],
      publishedAt: status === "active" ? new Date() : null,
    });

    const [savedOptions] = await Promise.all([
      replaceOptions(poll._id, options),
      replaceAudiences(poll._id, audiences),
    ]);

    await writeAudit(poll._id, actor, "created", { status });

    if (status === "active") {
      await fanOutPublishNotifications(poll, audiences, actor);
      await writeAudit(poll._id, actor, "published", {});
    }

    const refreshed = await Poll.findById(poll._id).lean();
    const aud = await PollAudience.find({ pollId: poll._id }).lean();

    res.status(201).json({
      item: {
        ...withId(refreshed),
        options: (savedOptions || []).map(withId),
        audiences: aud.map(withId),
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /:id
router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const poll = await Poll.findById(req.params.id).lean();
    if (!poll) return res.status(404).json({ error: { message: "Poll not found" } });
    const audiences = await PollAudience.find({ pollId: poll._id }).lean();
    if (!(await isUserEligible(req, poll, audiences))) {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }

    const [options, comments, decisions, actorEmp] = await Promise.all([
      PollOption.find({ pollId: poll._id }).sort({ sortOrder: 1 }).lean(),
      PollComment.find({ pollId: poll._id }).sort({ createdAt: -1 }).limit(100).lean(),
      PollDecision.find({ pollId: poll._id }).sort({ decidedAt: -1 }).lean(),
      loadEmployeeForUser(req),
    ]);

    const userIds = [getActor(req).id, String(actorEmp?._id || "")].filter(Boolean);
    const myVote = await PollVote.findOne({ pollId: poll._id, userId: { $in: userIds } }).lean();

    const canSeeResults =
      isAdmin(getActor(req).role) ||
      String(poll.creatorId) === getActor(req).id ||
      poll.status !== "active" ||
      poll.showResultsBeforeClose;

    const results = canSeeResults ? await computeResults(poll, options) : null;

    res.json({
      item: {
        ...withId(poll),
        options: options.map(withId),
        audiences: audiences.map(withId),
        comments: comments.map(withId),
        decisions: decisions.map(withId),
        myVote: myVote ? withId(myVote) : null,
        results,
      },
    });
  } catch (err) {
    next(err);
  }
});

// PUT /:id
router.put("/:id", requireAuth, async (req, res, next) => {
  try {
    const actor = getActor(req);
    const poll = await Poll.findById(req.params.id);
    if (!poll) return res.status(404).json({ error: { message: "Poll not found" } });
    if (!isAdmin(actor.role) && String(poll.creatorId) !== actor.id) {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }
    if (["closed", "implemented", "rejected", "archived"].includes(poll.status)) {
      return res.status(400).json({ error: { message: "Cannot edit a closed poll" } });
    }

    const body = req.body || {};
    const editable = ["draft", "scheduled"].includes(poll.status);
    if (editable) {
      if (body.title !== undefined) poll.title = String(body.title).trim();
      if (body.description !== undefined) poll.description = String(body.description);
      if (body.type !== undefined && POLL_TYPES.includes(body.type)) poll.type = body.type;
      if (body.scheduledAt !== undefined) poll.scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
      if (body.closesAt !== undefined) poll.closesAt = body.closesAt ? new Date(body.closesAt) : null;
      if (typeof body.allowEditUntilDeadline === "boolean") poll.allowEditUntilDeadline = body.allowEditUntilDeadline;
      if (typeof body.allowComments === "boolean") poll.allowComments = body.allowComments;
      if (typeof body.allowMultipleOptions === "boolean") poll.allowMultipleOptions = body.allowMultipleOptions;
      if (typeof body.showResultsBeforeClose === "boolean") poll.showResultsBeforeClose = body.showResultsBeforeClose;
      if (typeof body.sendInApp === "boolean") poll.sendInApp = body.sendInApp;
      if (typeof body.sendEmail === "boolean") poll.sendEmail = body.sendEmail;
      if (Array.isArray(body.attachments)) poll.attachments = body.attachments;
      if (Array.isArray(body.options)) await replaceOptions(poll._id, body.options);
      if (Array.isArray(body.audiences)) {
        await replaceAudiences(poll._id, body.audiences);
        poll.targetSummary = buildTargetSummary(body.audiences);
      }
      if (poll.scheduledAt && poll.scheduledAt > new Date() && poll.status === "draft") {
        poll.status = "scheduled";
      }
    } else if (poll.status === "active") {
      if (body.closesAt !== undefined) poll.closesAt = body.closesAt ? new Date(body.closesAt) : null;
      if (body.description !== undefined) poll.description = String(body.description);
    }

    await poll.save();
    await writeAudit(poll._id, actor, "updated", {});

    const [options, audiences] = await Promise.all([
      PollOption.find({ pollId: poll._id }).sort({ sortOrder: 1 }).lean(),
      PollAudience.find({ pollId: poll._id }).lean(),
    ]);

    res.json({
      item: { ...withId(poll.toObject()), options: options.map(withId), audiences: audiences.map(withId) },
    });
  } catch (err) {
    next(err);
  }
});

// POST /:id/publish
router.post("/:id/publish", requireAuth, async (req, res, next) => {
  try {
    const actor = getActor(req);
    const poll = await Poll.findById(req.params.id);
    if (!poll) return res.status(404).json({ error: { message: "Poll not found" } });
    if (!isAdmin(actor.role) && String(poll.creatorId) !== actor.id) {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }
    if (!["draft", "scheduled"].includes(poll.status)) {
      return res.status(400).json({ error: { message: "Only draft/scheduled polls can be published" } });
    }

    poll.status = "active";
    poll.publishedAt = new Date();
    await poll.save();

    const audiences = await PollAudience.find({ pollId: poll._id }).lean();
    await fanOutPublishNotifications(poll, audiences, actor);
    await writeAudit(poll._id, actor, "published", {});

    res.json({ item: withId(poll.toObject()) });
  } catch (err) {
    next(err);
  }
});

// POST /:id/close
router.post("/:id/close", requireAuth, async (req, res, next) => {
  try {
    const actor = getActor(req);
    const poll = await Poll.findById(req.params.id);
    if (!poll) return res.status(404).json({ error: { message: "Poll not found" } });
    if (!isAdmin(actor.role) && String(poll.creatorId) !== actor.id) {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }
    poll.status = "closed";
    poll.closedAt = new Date();
    await poll.save();
    await writeAudit(poll._id, actor, "closed", {});
    res.json({ item: withId(poll.toObject()) });
  } catch (err) {
    next(err);
  }
});

// POST /:id/archive
router.post("/:id/archive", requireAuth, async (req, res, next) => {
  try {
    const actor = getActor(req);
    const poll = await Poll.findById(req.params.id);
    if (!poll) return res.status(404).json({ error: { message: "Poll not found" } });
    if (!isAdmin(actor.role) && String(poll.creatorId) !== actor.id) {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }
    poll.status = "archived";
    await poll.save();
    await writeAudit(poll._id, actor, "archived", {});
    res.json({ item: withId(poll.toObject()) });
  } catch (err) {
    next(err);
  }
});

// POST /:id/duplicate
router.post("/:id/duplicate", requireAuth, async (req, res, next) => {
  try {
    const actor = getActor(req);
    if (!canCreate(actor.role)) return res.status(403).json({ error: { message: "Forbidden" } });
    const source = await Poll.findById(req.params.id).lean();
    if (!source) return res.status(404).json({ error: { message: "Poll not found" } });

    const [options, audiences] = await Promise.all([
      PollOption.find({ pollId: source._id }).sort({ sortOrder: 1 }).lean(),
      PollAudience.find({ pollId: source._id }).lean(),
    ]);

    const copy = await Poll.create({
      title: `${source.title} (Copy)`,
      description: source.description,
      type: source.type,
      status: "draft",
      allowEditUntilDeadline: source.allowEditUntilDeadline,
      allowComments: source.allowComments,
      allowMultipleOptions: source.allowMultipleOptions,
      showResultsBeforeClose: source.showResultsBeforeClose,
      creatorId: actor.id,
      creatorName: actor.name,
      creatorRole: actor.role,
      targetSummary: source.targetSummary,
      sendInApp: source.sendInApp,
      sendEmail: source.sendEmail,
      sendPush: source.sendPush,
      sendSms: source.sendSms,
      attachments: source.attachments || [],
    });

    await replaceOptions(
      copy._id,
      options.map((o) => ({ label: o.label, imageUrl: o.imageUrl, sortOrder: o.sortOrder }))
    );
    await replaceAudiences(
      copy._id,
      audiences.map((a) => ({
        targetType: a.targetType,
        targetId: a.targetId,
        targetLabel: a.targetLabel,
      }))
    );
    await writeAudit(copy._id, actor, "duplicated", { from: String(source._id) });

    res.status(201).json({ item: withId(copy.toObject()) });
  } catch (err) {
    next(err);
  }
});

// POST /:id/vote
router.post("/:id/vote", requireAuth, async (req, res, next) => {
  try {
    const actor = getActor(req);
    const poll = await Poll.findById(req.params.id).lean();
    if (!poll) return res.status(404).json({ error: { message: "Poll not found" } });
    if (poll.status !== "active") {
      return res.status(400).json({ error: { message: "Poll is not open for voting" } });
    }
    if (poll.closesAt && new Date(poll.closesAt) < new Date()) {
      return res.status(400).json({ error: { message: "Voting deadline has passed" } });
    }

    const audiences = await PollAudience.find({ pollId: poll._id }).lean();
    if (!(await isUserEligible(req, poll, audiences))) {
      return res.status(403).json({ error: { message: "You are not in this poll audience" } });
    }

    const emp = await loadEmployeeForUser(req);
    const userId = String(emp?._id || actor.id);
    const userName = emp?.name || actor.name;

    const existing = await PollVote.findOne({ pollId: poll._id, userId });
    if (existing && !poll.allowEditUntilDeadline) {
      return res.status(400).json({ error: { message: "Vote editing is disabled for this poll" } });
    }

    const { optionIds, rating, textAnswer } = req.body || {};
    let normalizedOptionIds = Array.isArray(optionIds) ? optionIds.filter(Boolean) : optionIds ? [optionIds] : [];

    if (poll.type === "yes_no" || poll.type === "multiple_choice") {
      if (!normalizedOptionIds.length) {
        return res.status(400).json({ error: { message: "Select at least one option" } });
      }
      if (!poll.allowMultipleOptions && normalizedOptionIds.length > 1) {
        normalizedOptionIds = [normalizedOptionIds[0]];
      }
    }
    if (poll.type === "rating_1_10") {
      const n = Number(rating);
      if (!Number.isFinite(n) || n < 1 || n > 10) {
        return res.status(400).json({ error: { message: "Rating must be 1–10" } });
      }
    }
    if (poll.type === "star_rating") {
      const n = Number(rating);
      if (!Number.isFinite(n) || n < 1 || n > 5) {
        return res.status(400).json({ error: { message: "Star rating must be 1–5" } });
      }
    }
    if (poll.type === "open_feedback") {
      if (!String(textAnswer || "").trim()) {
        return res.status(400).json({ error: { message: "Feedback text is required" } });
      }
    }

    let vote;
    if (existing) {
      existing.previousVote = {
        optionIds: existing.optionIds || [],
        rating: existing.rating,
        textAnswer: existing.textAnswer || "",
        changedAt: new Date(),
      };
      existing.optionIds = normalizedOptionIds;
      existing.rating = rating != null ? Number(rating) : null;
      existing.textAnswer = String(textAnswer || "");
      existing.userName = userName;
      await existing.save();
      vote = existing;
      await writeAudit(poll._id, actor, "vote_changed", { userId });
    } else {
      vote = await PollVote.create({
        pollId: poll._id,
        userId,
        userName,
        optionIds: normalizedOptionIds,
        rating: rating != null ? Number(rating) : null,
        textAnswer: String(textAnswer || ""),
      });
      await Poll.updateOne({ _id: poll._id }, { $inc: { voteCount: 1 } });
      await writeAudit(poll._id, actor, "voted", { userId });
    }

    res.json({ item: withId(vote.toObject ? vote.toObject() : vote) });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ error: { message: "Vote already exists" } });
    }
    next(err);
  }
});

// POST /:id/comments
router.post("/:id/comments", requireAuth, async (req, res, next) => {
  try {
    const actor = getActor(req);
    const poll = await Poll.findById(req.params.id).lean();
    if (!poll) return res.status(404).json({ error: { message: "Poll not found" } });
    if (!poll.allowComments) {
      return res.status(400).json({ error: { message: "Comments are disabled" } });
    }
    const audiences = await PollAudience.find({ pollId: poll._id }).lean();
    if (!(await isUserEligible(req, poll, audiences))) {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }

    const body = String(req.body?.body || "").trim();
    if (!body) return res.status(400).json({ error: { message: "Comment body is required" } });

    const emp = await loadEmployeeForUser(req);
    const comment = await PollComment.create({
      pollId: poll._id,
      userId: String(emp?._id || actor.id),
      userName: emp?.name || actor.name,
      body,
      attachments: Array.isArray(req.body?.attachments) ? req.body.attachments : [],
    });
    await Poll.updateOne({ _id: poll._id }, { $inc: { commentCount: 1 } });
    await writeAudit(poll._id, actor, "commented", {});

    res.status(201).json({ item: withId(comment.toObject()) });
  } catch (err) {
    next(err);
  }
});

// GET /:id/results
router.get("/:id/results", requireAuth, async (req, res, next) => {
  try {
    const poll = await Poll.findById(req.params.id).lean();
    if (!poll) return res.status(404).json({ error: { message: "Poll not found" } });
    const audiences = await PollAudience.find({ pollId: poll._id }).lean();
    if (!(await isUserEligible(req, poll, audiences))) {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }
    const actor = getActor(req);
    const canSee =
      isAdmin(actor.role) ||
      String(poll.creatorId) === actor.id ||
      poll.status !== "active" ||
      poll.showResultsBeforeClose;
    if (!canSee) {
      return res.status(403).json({ error: { message: "Results are hidden until the poll closes" } });
    }
    const options = await PollOption.find({ pollId: poll._id }).sort({ sortOrder: 1 }).lean();
    const results = await computeResults(poll, options);
    res.json({ item: results });
  } catch (err) {
    next(err);
  }
});

// POST /:id/decision
router.post("/:id/decision", requireAuth, async (req, res, next) => {
  try {
    const actor = getActor(req);
    if (!canDecide(actor.role)) {
      return res.status(403).json({ error: { message: "Only admins can record decisions" } });
    }
    const poll = await Poll.findById(req.params.id);
    if (!poll) return res.status(404).json({ error: { message: "Poll not found" } });

    const decision = String(req.body?.decision || "").trim();
    if (!["implemented", "rejected", "deferred"].includes(decision)) {
      return res.status(400).json({ error: { message: "Invalid decision" } });
    }

    const record = await PollDecision.create({
      pollId: poll._id,
      decision,
      notes: String(req.body?.notes || ""),
      decidedById: actor.id,
      decidedByName: actor.name,
      decidedAt: new Date(),
    });

    if (decision === "implemented" || decision === "rejected") {
      poll.status = decision;
      await poll.save();
    }

    await writeAudit(poll._id, actor, "decision", { decision });
    res.status(201).json({ item: withId(record.toObject()), poll: withId(poll.toObject()) });
  } catch (err) {
    next(err);
  }
});

// GET /:id/audit-log
router.get("/:id/audit-log", requireAuth, async (req, res, next) => {
  try {
    const actor = getActor(req);
    if (!canCreate(actor.role)) {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }
    const items = await PollAuditLog.find({ pollId: req.params.id }).sort({ createdAt: -1 }).limit(200).lean();
    res.json({ items: items.map(withId) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
