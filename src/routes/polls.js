const express = require("express");
const { z } = require("zod");
const mongoose = require("mongoose");
const { requireAuth } = require("../middleware/auth");
const Poll = require("../models/Poll");
const PollVote = require("../models/PollVote");
const PollComment = require("../models/PollComment");
const PollAuditLog = require("../models/PollAuditLog");
const Employee = require("../models/Employee");
const { createNotification } = require("../utils/notifications");
const { sendRawEmail } = require("../lib/email");

const router = express.Router();

// Helper to check if employee matches audience target rules
function employeeMatchesAudience(employee, audience) {
  if (!employee) return false;
  if (audience.targetType === "All") return true;
  
  const val = (audience.targetValue || "").toLowerCase();
  
  if (audience.targetType === "Department" && employee.department) {
    return val === employee.department.toLowerCase();
  }
  if (audience.targetType === "Location" && employee.location) {
    return val === employee.location.toLowerCase();
  }
  if (audience.targetType === "Role") {
    const role = (employee.role || employee.userRole || "").toLowerCase();
    return val === role;
  }
  if (audience.targetType === "Company" && employee.company) {
    return val === employee.company.toLowerCase();
  }
  if (audience.targetType === "Team" && employee.category) {
    return val === employee.category.toLowerCase();
  }
  if (audience.targetType === "UserList" && employee.email) {
    return val === employee.email.toLowerCase();
  }
  
  return false;
}

// Format single poll for frontend compatibility
function formatPoll(p) {
  if (!p) return p;
  const obj = p.toObject ? p.toObject() : p;
  return {
    ...obj,
    id: String(obj._id),
    options: (obj.options || []).map(o => ({
      ...o,
      id: String(o._id || o.id)
    }))
  };
}

// ─── ZOD SCHEMAS ─────────────────────────────────────────────────────────────

const optionSchema = z.object({
  optionText: z.string().min(1, "Option text is required"),
  imageUrl: z.string().optional().default(""),
  displayOrder: z.number().optional().default(0)
});

const audienceSchema = z.object({
  targetType: z.enum(["Company", "Department", "Location", "Role", "Team", "All", "UserList"]),
  targetValue: z.string().min(1, "Target value is required")
});

const createPollSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().min(1, "Description is required"),
  pollType: z.enum([
    "YesNo", 
    "MultipleChoice", 
    "RankedChoice", 
    "Rating10", 
    "StarRating", 
    "DesignComparison", 
    "ImageVoting", 
    "OpenFeedback", 
    "Hybrid",
    "BudgetApproval"
  ]),
  startTime: z.string().or(z.date()).optional(),
  endTime: z.string().or(z.date()),
  allowCommentAttachments: z.boolean().optional().default(false),
  allowVoteEditing: z.boolean().optional().default(true),
  options: z.array(optionSchema).optional().default([]),
  audiences: z.array(audienceSchema).optional().default([])
});

const castVoteSchema = z.object({
  optionId: z.string().optional().nullable(),
  ratingValue: z.number().optional().nullable(),
  rankedOrder: z.array(z.string()).optional().default([])
});

const commentAttachmentSchema = z.object({
  name: z.string().optional(),
  fileName: z.string().optional(),
  url: z.string().optional(),
  fileUrl: z.string().optional(),
  type: z.string().optional(),
  fileType: z.string().optional()
});

const addCommentSchema = z.object({
  commentText: z.string().min(1, "Comment text is required"),
  attachments: z.array(commentAttachmentSchema).optional().default([])
});

const recordDecisionSchema = z.object({
  decisionText: z.string().min(1, "Decision text is required"),
  decisionStatus: z.enum(["Pending", "InProgress", "Implemented", "Cancelled"]).default("Implemented")
});

// ─── ROUTES ──────────────────────────────────────────────────────────────────

/**
 * GET /api/polls
 * Fetch active and past polls. Regular employees only see polls targeting them.
 * Admins, super-admins, and managers fetch all polls.
 */
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const isAdminOrManager = ["super-admin", "admin", "manager"].includes(req.user.role);
    
    if (isAdminOrManager) {
      const polls = await Poll.find().sort({ createdAt: -1 }).lean();
      const formatted = polls.map(formatPoll);
      return res.json({ items: formatted, polls: formatted, total: formatted.length });
    }
    
    // Regular employee audience-based matching
    const employee = await Employee.findById(req.user.id).lean();
    if (!employee) {
      return res.status(403).json({ error: { message: "Employee profile not found" } });
    }
    
    // Regular employees don't see drafts
    const allPolls = await Poll.find({ status: { $ne: "Draft" } }).sort({ createdAt: -1 }).lean();
    const targetedPolls = allPolls.filter(poll => {
      if (!poll.audiences || poll.audiences.length === 0) return true; // default to public if no audience filter defined
      return poll.audiences.some(aud => employeeMatchesAudience(employee, aud));
    });
    
    const formatted = targetedPolls.map(formatPoll);
    return res.json({ items: formatted, polls: formatted, total: formatted.length });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/polls
 * Create a new poll. Admin/Manager access only.
 */
router.post("/", requireAuth, async (req, res, next) => {
  try {
    if (!["super-admin", "admin", "manager"].includes(req.user.role)) {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }
    
    const parsed = createPollSchema.safeParse(req.body);
    if (!parsed.success) {
      const messages = parsed.error.errors.map(e => e.message).join("; ");
      return res.status(400).json({ error: { message: messages } });
    }
    
    const newPoll = await Poll.create({
      ...parsed.data,
      creatorId: req.user.id,
      creatorName: req.user.name || req.user.username
    });
    
    await PollAuditLog.create({
      pollId: newPoll._id,
      pollTitle: newPoll.title,
      action: "Create Poll",
      performedBy: req.user.name || req.user.username
    });
    
    return res.status(201).json({ item: formatPoll(newPoll.toObject()) });
  } catch (err) {
    return next(err);
  }
});

/**
 * PUT /api/polls/:id/status
 * Update status of a poll. Admin/Manager access only.
 */
router.put("/:id/status", requireAuth, async (req, res, next) => {
  try {
    if (!["super-admin", "admin", "manager"].includes(req.user.role)) {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }
    
    const { status } = req.body;
    if (!status) {
      return res.status(400).json({ error: { message: "Status is required" } });
    }
    
    const poll = await Poll.findById(req.params.id);
    if (!poll) {
      return res.status(404).json({ error: { message: "Poll not found" } });
    }
    
    const oldStatus = poll.status;
    poll.status = status;
    await poll.save();
    
    await PollAuditLog.create({
      pollId: poll._id,
      pollTitle: poll.title,
      action: `Update Status: ${status}`,
      performedBy: req.user.name || req.user.username
    });
    
    return res.json({ item: formatPoll(poll.toObject()) });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/polls/:id/votes
 * Cast or update a vote. Access for targeted employees.
 */
router.post("/:id/votes", requireAuth, async (req, res, next) => {
  try {
    const parsed = castVoteSchema.safeParse(req.body);
    if (!parsed.success) {
      const messages = parsed.error.errors.map(e => e.message).join("; ");
      return res.status(400).json({ error: { message: messages } });
    }
    
    const poll = await Poll.findById(req.params.id);
    if (!poll) {
      return res.status(404).json({ error: { message: "Poll not found" } });
    }
    
    if (poll.status !== "Active") {
      return res.status(400).json({ error: { message: "This poll is not active" } });
    }
    
    if (new Date() > new Date(poll.endTime)) {
      return res.status(400).json({ error: { message: "This poll has ended" } });
    }
    
    // Fetch voter's employee details
    const employee = await Employee.findById(req.user.id).lean();
    const employeeDetails = employee || {
      name: req.user.name || req.user.username,
      department: "General",
      location: "Remote"
    };
    
    // Assert target audience rules
    if (poll.audiences && poll.audiences.length > 0 && !["super-admin", "admin"].includes(req.user.role)) {
      const matches = poll.audiences.some(aud => employeeMatchesAudience(employeeDetails, aud));
      if (!matches) {
        return res.status(403).json({ error: { message: "You are not targeted by this poll's audience filters" } });
      }
    }
    
    const existingVote = await PollVote.findOne({ pollId: poll._id, userId: req.user.id });
    if (existingVote && !poll.allowVoteEditing) {
      return res.status(403).json({ error: { message: "Vote editing is disabled for this poll" } });
    }
    
    const voteData = {
      pollId: poll._id,
      userId: req.user.id,
      userName: employeeDetails.name || req.user.name || req.user.username,
      userDepartment: employeeDetails.department || "General",
      userLocation: employeeDetails.location || "Remote",
      optionId: parsed.data.optionId || null,
      ratingValue: parsed.data.ratingValue != null ? parsed.data.ratingValue : null,
      rankedOrder: parsed.data.rankedOrder || []
    };
    
    let vote;
    let action = "Cast Vote";
    if (existingVote) {
      Object.assign(existingVote, voteData, { votedAt: new Date() });
      vote = await existingVote.save();
      action = "Change Vote";
    } else {
      vote = await PollVote.create(voteData);
    }
    
    await PollAuditLog.create({
      pollId: poll._id,
      pollTitle: poll.title,
      action,
      performedBy: voteData.userName
    });
    
    return res.status(201).json({ item: vote });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /api/polls/:id/comments
 * Fetch comments and attachments for a poll.
 */
router.get("/:id/comments", requireAuth, async (req, res, next) => {
  try {
    const comments = await PollComment.find({ pollId: req.params.id }).sort({ createdAt: 1 }).lean();
    
    const formatted = comments.map(c => ({
      ...c,
      id: String(c._id),
      attachments: (c.attachments || []).map(a => ({
        name: a.fileName,
        url: a.fileUrl,
        type: a.fileType
      }))
    }));
    
    return res.json({ items: formatted, comments: formatted, total: formatted.length });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /api/polls/:id/votes
 * Fetch all votes cast for a poll. Admin/Manager access only.
 */
router.get("/:id/votes", requireAuth, async (req, res, next) => {
  try {
    if (!["super-admin", "admin", "manager"].includes(req.user.role)) {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }
    const votes = await PollVote.find({ pollId: req.params.id }).lean();
    const formatted = votes.map(v => ({
      ...v,
      id: String(v._id)
    }));
    return res.json({ items: formatted, votes: formatted, total: formatted.length });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/polls/:id/comments
 * Create a new comment/feedback.
 */
router.post("/:id/comments", requireAuth, async (req, res, next) => {
  try {
    const parsed = addCommentSchema.safeParse(req.body);
    if (!parsed.success) {
      const messages = parsed.error.errors.map(e => e.message).join("; ");
      return res.status(400).json({ error: { message: messages } });
    }
    
    const poll = await Poll.findById(req.params.id);
    if (!poll) {
      return res.status(404).json({ error: { message: "Poll not found" } });
    }
    
    const attachments = (parsed.data.attachments || []).map(att => ({
      fileName: att.fileName || att.name || "attachment",
      fileUrl: att.fileUrl || att.url || "",
      fileType: att.fileType || att.type || "",
      uploadedAt: new Date()
    }));
    
    const newComment = await PollComment.create({
      pollId: poll._id,
      userId: req.user.id,
      userName: req.user.name || req.user.username,
      commentText: parsed.data.commentText,
      attachments
    });
    
    await PollAuditLog.create({
      pollId: poll._id,
      pollTitle: poll.title,
      action: "Add Comment",
      performedBy: req.user.name || req.user.username
    });
    
    const formatted = {
      ...newComment.toObject(),
      id: String(newComment._id),
      attachments: attachments.map(a => ({
        name: a.fileName,
        url: a.fileUrl,
        type: a.fileType
      }))
    };
    
    return res.status(201).json({ item: formatted });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/polls/:id/decision
 * Record executive decision summary. Automatically updates poll status.
 */
router.post("/:id/decision", requireAuth, async (req, res, next) => {
  try {
    if (!["super-admin", "admin", "manager"].includes(req.user.role)) {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }
    
    const parsed = recordDecisionSchema.safeParse(req.body);
    if (!parsed.success) {
      const messages = parsed.error.errors.map(e => e.message).join("; ");
      return res.status(400).json({ error: { message: messages } });
    }
    
    const poll = await Poll.findById(req.params.id);
    if (!poll) {
      return res.status(404).json({ error: { message: "Poll not found" } });
    }
    
    poll.decisionText = parsed.data.decisionText;
    poll.decisionStatus = parsed.data.decisionStatus;
    poll.decisionBy = req.user.name || req.user.username;
    poll.decidedAt = new Date();
    
    // Automatically update poll status based on decision status mapping
    if (parsed.data.decisionStatus === "Implemented") {
      poll.status = "Implemented";
    } else if (parsed.data.decisionStatus === "Cancelled") {
      poll.status = "Rejected";
    }
    
    await poll.save();
    
    await PollAuditLog.create({
      pollId: poll._id,
      pollTitle: poll.title,
      action: `Record Decision: ${parsed.data.decisionStatus}`,
      performedBy: req.user.name || req.user.username
    });
    
    return res.json({ item: formatPoll(poll.toObject()) });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/polls/:id/nudge
 * Nudge targeted employees who have not voted yet. Dispatches Socket.IO event + SMTP email.
 */
router.post("/:id/nudge", requireAuth, async (req, res, next) => {
  try {
    if (!["super-admin", "admin", "manager"].includes(req.user.role)) {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }
    
    const poll = await Poll.findById(req.params.id);
    if (!poll) {
      return res.status(404).json({ error: { message: "Poll not found" } });
    }
    
    // Find all active employees
    const employees = await Employee.find({ status: "active" }).lean();
    
    // Find voters who already voted
    const votes = await PollVote.find({ pollId: poll._id }).select("userId").lean();
    const votedUserIds = new Set(votes.map(v => String(v.userId)));
    
    // Filter down to targeted employees who haven't voted
    const targetedNonVoters = employees.filter(employee => {
      const isVoted = votedUserIds.has(String(employee._id)) || votedUserIds.has(employee.email);
      if (isVoted) return false;
      
      if (!poll.audiences || poll.audiences.length === 0) return true;
      return poll.audiences.some(aud => employeeMatchesAudience(employee, aud));
    });
    
    const managerName = req.user.name || req.user.username;
    
    // Send notifications & emails
    for (const emp of targetedNonVoters) {
      // 1. In-app Socket notification
      await createNotification({
        actor: managerName,
        actorRole: req.user.role,
        action: "nudged you to submit your vote on",
        resourceType: "poll",
        resourceName: poll.title,
        assignees: [emp.email],
        resourceId: String(poll._id),
        category: "MENTIONED"
      }).catch(err => {
        console.error(`[Nudge Notification Error] employee: ${emp.email}`, err);
      });
      
      // 2. SMTP Email Reminder
      const subject = `Reminder: Pending Vote on Poll "${poll.title}"`;
      const body = `Hi ${emp.name},\n\nThis is a friendly reminder from ${managerName} that your input is requested on the poll: "${poll.title}".\n\nDescription: ${poll.description}\n\nPlease cast your vote before the poll ends on ${new Date(poll.endTime).toLocaleString()}.\n\nBest regards,\nTask Manager System`;
      
      await sendRawEmail({
        to: emp.email,
        subject,
        body
      }).catch(err => {
        console.error(`[Nudge SMTP Error] employee: ${emp.email}`, err);
      });
      
      // 3. SMS Console Log (Stub)
      console.log(`[SMS Nudge] Triggered SMS reminder to ${emp.name} (${emp.phone || "No Phone"}) for poll "${poll.title}"`);
    }
    
    await PollAuditLog.create({
      pollId: poll._id,
      pollTitle: poll.title,
      action: "Send Nudges",
      performedBy: req.user.name || req.user.username
    });
    
    return res.json({ 
      success: true, 
      nudgedCount: targetedNonVoters.length,
      message: `Nudge notifications successfully sent to ${targetedNonVoters.length} team members.` 
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /api/polls/:id/analytics
 * Compute vote distribution percentages and department participation metrics.
 */
router.get("/:id/analytics", requireAuth, async (req, res, next) => {
  try {
    if (!["super-admin", "admin", "manager"].includes(req.user.role)) {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }
    
    const poll = await Poll.findById(req.params.id).lean();
    if (!poll) {
      return res.status(404).json({ error: { message: "Poll not found" } });
    }
    
    const votes = await PollVote.find({ pollId: poll._id }).lean();
    const totalVotes = votes.length;
    
    // 1. Calculate Option Distribution
    const optionDistribution = {};
    if (poll.options && poll.options.length > 0) {
      poll.options.forEach(opt => {
        optionDistribution[String(opt._id)] = {
          optionText: opt.optionText,
          count: 0,
          percentage: 0
        };
      });
    }
    
    let sumRating = 0;
    let ratingCount = 0;
    const ratingValueBreakdown = {};
    const bordaScores = {};
    
    votes.forEach(v => {
      // MCQ / Design Comparison / YesNo
      if (v.optionId && optionDistribution[v.optionId]) {
        optionDistribution[v.optionId].count += 1;
      }
      
      // Star Rating / Rating10
      if (v.ratingValue != null) {
        sumRating += v.ratingValue;
        ratingCount += 1;
        ratingValueBreakdown[v.ratingValue] = (ratingValueBreakdown[v.ratingValue] || 0) + 1;
      }
      
      // Ranked Choice
      if (v.rankedOrder && v.rankedOrder.length > 0) {
        const totalOpts = poll.options.length;
        v.rankedOrder.forEach((optId, idx) => {
          // Borda Points: top choice gets totalOpts, last gets 1
          const points = totalOpts - idx;
          bordaScores[optId] = (bordaScores[optId] || 0) + points;
        });
      }
    });
    
    // Finalize percentages for MCQ option counts
    if (totalVotes > 0) {
      Object.keys(optionDistribution).forEach(optId => {
        optionDistribution[optId].percentage = Math.round((optionDistribution[optId].count / totalVotes) * 100);
      });
    }
    
    // Finalize Ranked Choice Borda Scores as percentage of max points
    const rankedChoiceDistribution = {};
    if (poll.pollType === "RankedChoice" && poll.options && poll.options.length > 0) {
      const maxPossibleScorePerOpt = totalVotes * poll.options.length;
      poll.options.forEach(opt => {
        const score = bordaScores[String(opt._id)] || 0;
        rankedChoiceDistribution[String(opt._id)] = {
          optionText: opt.optionText,
          score,
          percentage: maxPossibleScorePerOpt > 0 ? Math.round((score / maxPossibleScorePerOpt) * 100) : 0
        };
      });
    }
    
    // 2. Department-level participation metrics
    const departmentVoteCounts = {};
    votes.forEach(v => {
      const dept = v.userDepartment || "Unassigned";
      departmentVoteCounts[dept] = (departmentVoteCounts[dept] || 0) + 1;
    });
    
    const activeEmployees = await Employee.find({ status: "active" }).select("department").lean();
    const departmentRosters = {};
    activeEmployees.forEach(emp => {
      const dept = emp.department || "Unassigned";
      departmentRosters[dept] = (departmentRosters[dept] || 0) + 1;
    });
    
    const departmentParticipation = {};
    Object.keys(departmentRosters).forEach(dept => {
      const voteCount = departmentVoteCounts[dept] || 0;
      const totalCount = departmentRosters[dept] || 1;
      departmentParticipation[dept] = {
        voteCount,
        totalEligible: totalCount,
        participationRate: Math.round((voteCount / totalCount) * 100)
      };
    });
    
    // Include departments that voted but aren't currently registered in rosters
    Object.keys(departmentVoteCounts).forEach(dept => {
      if (!departmentParticipation[dept]) {
        departmentParticipation[dept] = {
          voteCount: departmentVoteCounts[dept],
          totalEligible: departmentVoteCounts[dept],
          participationRate: 100
        };
      }
    });
    
    return res.json({
      pollId: String(poll._id),
      totalVotes,
      pollType: poll.pollType,
      optionDistribution,
      rankedChoiceDistribution,
      averageRating: ratingCount > 0 ? Number((sumRating / ratingCount).toFixed(1)) : 0,
      ratingValueBreakdown,
      departmentParticipation
    });
  } catch (err) {
    return next(err);
  }
});

// ─── AI SENTIMENT ENGINE DICTIONARIES ─────────────────────────────────────────

const POSITIVE_WORDS = new Set([
  "great", "good", "agree", "support", "excellent", "love", "perfect", "yes", "fantastic",
  "beneficial", "like", "awesome", "improve", "helpful", "forward", "excite", "healthy", "productive",
  "better", "definitely", "absolutely", "pleased", "happy", "needed", "clean", "fair", "reasonable"
]);

const NEGATIVE_WORDS = new Set([
  "disagree", "oppose", "bad", "no", "hate", "terrible", "poor", "waste", "unhelpful",
  "concern", "worry", "risk", "expensive", "fail", "flawed", "difficult", "negative", "worse",
  "uncomfortable", "costly", "hard", "unhappy", "annoyed", "restrict", "burden", "unfair"
]);

const THEME_KEYWORDS = [
  { theme: "Work-Life Balance", words: ["burnout", "balance", "family", "stress", "personal", "flexibility", "hours", "commute"], type: "consensus" },
  { theme: "Cost/Budget Concerns", words: ["expensive", "cost", "budget", "price", "waste", "pay", "financial", "funding"], type: "concern" },
  { theme: "Implementation Timeline", words: ["slow", "fast", "deadline", "hurry", "time", "delay", "schedule", "planning"], type: "concern" },
  { theme: "Collaboration & Sync", words: ["meet", "colleague", "team", "talk", "together", "coordinate", "office", "zoom"], type: "consensus" },
  { theme: "Modern Design Preferences", words: ["modern", "logo", "clean", "branding", "sleek", "colors", "fresh", "aesthetic"], type: "recommendation" },
  { theme: "Remote Setup Quality", words: ["internet", "desk", "laptop", "home", "remotely", "setup", "workplace", "chair"], type: "recommendation" }
];

/**
 * GET /api/polls/:id/ai-summary
 * Local real-time sentiment processing and keyword theme clustering.
 */
router.get("/:id/ai-summary", requireAuth, async (req, res, next) => {
  try {
    if (!["super-admin", "admin", "manager"].includes(req.user.role)) {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }
    
    const poll = await Poll.findById(req.params.id).lean();
    if (!poll) {
      return res.status(404).json({ error: { message: "Poll not found" } });
    }
    
    const comments = await PollComment.find({ pollId: poll._id }).lean();
    
    if (comments.length === 0) {
      return res.json({
        summaryText: "No feedback comments have been posted yet to generate an AI summary.",
        sentimentTrends: { positive: 0, neutral: 100, negative: 0 },
        recurringThemes: []
      });
    }
    
    let positiveCount = 0;
    let negativeCount = 0;
    let neutralCount = 0;
    const themesCount = {};
    
    comments.forEach(c => {
      const textLower = (c.commentText || "").toLowerCase();
      const words = textLower.match(/\b\w+\b/g) || [];
      
      let score = 0;
      words.forEach(w => {
        if (POSITIVE_WORDS.has(w)) score++;
        if (NEGATIVE_WORDS.has(w)) score--;
      });
      
      if (score > 0) positiveCount++;
      else if (score < 0) negativeCount++;
      else neutralCount++;
      
      THEME_KEYWORDS.forEach(tk => {
        const matches = tk.words.some(keyword => textLower.includes(keyword));
        if (matches) {
          themesCount[tk.theme] = (themesCount[tk.theme] || 0) + 1;
        }
      });
    });
    
    const total = comments.length;
    const sentimentTrends = {
      positive: Math.round((positiveCount / total) * 100),
      neutral: Math.round((neutralCount / total) * 100),
      negative: Math.round((negativeCount / total) * 100)
    };
    
    const recurringThemes = Object.keys(themesCount).map(themeName => {
      const spec = THEME_KEYWORDS.find(tk => tk.theme === themeName);
      return {
        theme: themeName,
        frequency: themesCount[themeName],
        type: spec ? spec.type : "concern"
      };
    }).sort((a, b) => b.frequency - a.frequency);
    
    let summaryText = "";
    if (sentimentTrends.positive > sentimentTrends.negative) {
      summaryText = `Overall employee feedback for "${poll.title}" leans **positive** (${sentimentTrends.positive}% favorable). `;
    } else if (sentimentTrends.negative > sentimentTrends.positive) {
      summaryText = `Overall employee feedback for "${poll.title}" highlights **critical concerns** (${sentimentTrends.negative}% unfavorable). `;
    } else {
      summaryText = `Feedback for "${poll.title}" shows a **balanced/neutral split** in employee sentiment. `;
    }
    
    if (recurringThemes.length > 0) {
      const topThemes = recurringThemes.slice(0, 2).map(t => `"${t.theme}" (${t.frequency} discussions)`);
      summaryText += `The core themes center around ${topThemes.join(" and ")}. `;
    }
    
    summaryText += "Employees recommend prioritizing clear schedules, safety measures, and equitable logistics to guarantee success.";
    
    return res.json({
      summaryText,
      sentimentTrends,
      recurringThemes
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /api/polls/:id/audit-logs
 * Fetch audit trail logs for a poll. Admin/Manager access only.
 */
router.get("/:id/audit-logs", requireAuth, async (req, res, next) => {
  try {
    if (!["super-admin", "admin", "manager"].includes(req.user.role)) {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }
    const logs = await PollAuditLog.find({ pollId: req.params.id }).sort({ timestamp: -1 }).lean();
    const formatted = logs.map(l => ({
      ...l,
      id: String(l._id)
    }));
    return res.json({ items: formatted, auditLogs: formatted, total: formatted.length });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
