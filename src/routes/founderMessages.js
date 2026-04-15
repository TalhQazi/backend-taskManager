const express = require("express");
const { z } = require("zod");
const FounderMessage = require("../models/FounderMessage");
const UserPreference = require("../models/UserPreference");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// 180 Motivational Messages Library
const defaultMessages = [
  "Stay focused.",
  "Execute daily.",
  "Build momentum.",
  "Small wins matter.",
  "Progress not perfection.",
  "Show up consistently.",
  "Do the hard work.",
  "Trust the process.",
  "Keep moving forward.",
  "Discipline equals freedom.",
  "Action cures fear.",
  "Start before ready.",
  "Done is better than perfect.",
  "One step at a time.",
  "Consistency beats intensity.",
  "Focus on what matters.",
  "Eliminate distractions.",
  "Time is precious.",
  "Work with purpose.",
  "Create value daily.",
  "Solve real problems.",
  "Ship it today.",
  "Feedback is a gift.",
  "Iterate fast.",
  "Learn from failures.",
  "Embrace the struggle.",
  "Push through resistance.",
  "Comfort zones kill growth.",
  "Get uncomfortable.",
  "Growth requires pain.",
  "Challenges build character.",
  "Obstacles are opportunities.",
  "Never stop learning.",
  "Read every day.",
  "Ask better questions.",
  "Listen more than talk.",
  "Stay curious.",
  "Question assumptions.",
  "Think independently.",
  "Be radically honest.",
  "Integrity over everything.",
  "Keep your promises.",
  "Under promise, over deliver.",
  "Be reliable.",
  "Show empathy.",
  "Help others win.",
  "Give without expectation.",
  "Build relationships.",
  "Communication is key.",
  "Clarity over cleverness.",
  "Say no often.",
  "Protect your energy.",
  "Guard your time.",
  "Rest is productive.",
  "Sleep is essential.",
  "Move your body.",
  "Health is wealth.",
  "Mindset is everything.",
  "Think long term.",
  "Play infinite games.",
  "Build for decades.",
  "Compound your efforts.",
  "Patience pays off.",
  "Delay gratification.",
  "Stay humble.",
  "Ego is the enemy.",
  "Stay hungry.",
  "Never settle.",
  "Aim higher.",
  "Dream bigger.",
  "Vision drives action.",
  "Purpose fuels persistence.",
  "Know your why.",
  "Start with why.",
  "Values guide decisions.",
  "Principles over rules.",
  "First principles thinking.",
  "Question everything.",
  "Think from basics.",
  "Simplify everything.",
  "Less but better.",
  "Essentialism wins.",
  "Quality over quantity.",
  "Depth over breadth.",
  "Master your craft.",
  "Become the best.",
  "Excellence is a habit.",
  "Raise your standards.",
  "Details matter.",
  "Craftsmanship counts.",
  "Build with care.",
  "Design matters.",
  "User experience first.",
  "Customer obsession.",
  "Listen to users.",
  "Solve their pain.",
  "Make it useful.",
  "Make it simple.",
  "Make it fast.",
  "Speed matters.",
  "Move fast.",
  "Break things.",
  "Experiment often.",
  "Test assumptions.",
  "Data informs intuition.",
  "Measure what matters.",
  "What gets measured improves.",
  "Track your progress.",
  "Celebrate small wins.",
  "Acknowledge growth.",
  "Gratitude daily.",
  "Count blessings.",
  "Stay positive.",
  "Optimism is a choice.",
  "Mindset shifts reality.",
  "Believe in yourself.",
  "Confidence grows with action.",
  "Impostor syndrome lies.",
  "You belong here.",
  "You are enough.",
  "Trust your instincts.",
  "Follow your gut.",
  "Take calculated risks.",
  "Fortune favors bold.",
  "Fear is temporary.",
  "Regret lasts forever.",
  "Go for it.",
  "Just begin.",
  "The time is now.",
  "No more waiting.",
  "Stop planning. Start doing.",
  "Plans mean nothing.",
  "Execution is everything.",
  "Results over effort.",
  "Outcomes over outputs.",
  "Impact over activity.",
  "Meaningful work matters.",
  "Purpose over profit.",
  "Mission drives method.",
  "Build what matters.",
  "Create what you wish existed.",
  "Fix what's broken.",
  "Improve the world.",
  "Leave it better.",
  "Legacy over currency.",
  "What will you build?",
  "What impact will you make?",
  "How will you be remembered?",
  "Make it count.",
  "This is your moment.",
  "Your time is now.",
  "Seize the day.",
  "Carpe diem.",
  "Memento mori.",
  "Life is short.",
  "Time waits for no one.",
  "Tick tock.",
  "The clock is running.",
  "What are you waiting for?",
  "Start now.",
  "Begin today.",
  "Today is the day.",
  "Make it happen.",
  "Make it real.",
  "Bring it to life.",
  "Create magic.",
  "Build dreams.",
  "Dream. Build. Repeat."
];

// Initialize default messages if none exist
async function initializeMessages() {
  const count = await FounderMessage.countDocuments();
  if (count === 0) {
    const messages = defaultMessages.map((msg, index) => ({
      message: msg,
      isActive: true,
      order: index,
    }));
    await FounderMessage.insertMany(messages);
    console.log("✅ Founder messages initialized");
  }
}

// GET all messages (admin)
router.get("/admin", requireAuth, async (_req, res, next) => {
  try {
    const messages = await FounderMessage.find().sort({ order: 1 });
    return res.json({ items: messages });
  } catch (err) {
    return next(err);
  }
});

// GET random messages for user (shuffled, only active)
router.get("/random", requireAuth, async (req, res, next) => {
  try {
    // Check user preference
    const userId = String(req.user?.sub || req.user?.id || "");
    const preference = await UserPreference.findOne({ userId });
    
    if (preference && !preference.showFounderMessages) {
      return res.json({ items: [], enabled: false });
    }

    // Get all active messages
    const messages = await FounderMessage.find({ isActive: true });
    
    if (messages.length === 0) {
      return res.json({ items: [], enabled: true });
    }

    // Shuffle messages (Fisher-Yates algorithm)
    const shuffled = [...messages];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    return res.json({ 
      items: shuffled.map(m => ({ id: m._id, message: m.message })),
      enabled: true 
    });
  } catch (err) {
    return next(err);
  }
});

// GET user preference
router.get("/preference", requireAuth, async (req, res, next) => {
  try {
    const userId = String(req.user?.sub || req.user?.id || "");
    let preference = await UserPreference.findOne({ userId });
    
    if (!preference) {
      preference = await UserPreference.create({
        userId,
        showFounderMessages: true,
      });
    }
    
    return res.json({ showFounderMessages: preference.showFounderMessages });
  } catch (err) {
    return next(err);
  }
});

// UPDATE user preference
router.put("/preference", requireAuth, async (req, res, next) => {
  try {
    const userId = String(req.user?.sub || req.user?.id || "");
    const { showFounderMessages } = req.body;
    
    const preference = await UserPreference.findOneAndUpdate(
      { userId },
      { 
        userId,
        showFounderMessages: Boolean(showFounderMessages),
        updatedAt: Date.now()
      },
      { upsert: true, new: true }
    );
    
    return res.json({ showFounderMessages: preference.showFounderMessages });
  } catch (err) {
    return next(err);
  }
});

// CREATE new message (admin)
const createSchema = z.object({
  message: z.string().min(1, "Message is required").max(200, "Message too long"),
});

router.post("/admin", requireAuth, async (req, res, next) => {
  try {
    const role = String(req.user?.role || "").toLowerCase();
    if (role !== "admin" && role !== "super-admin") {
      return res.status(403).json({ error: { message: "Forbidden: Admin access required" } });
    }

    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload", details: parsed.error.errors } });
    }

    const maxOrder = await FounderMessage.findOne().sort({ order: -1 });
    const newOrder = maxOrder ? maxOrder.order + 1 : 0;

    const message = await FounderMessage.create({
      message: parsed.data.message,
      isActive: true,
      order: newOrder,
    });

    return res.status(201).json({ item: message });
  } catch (err) {
    return next(err);
  }
});

// UPDATE message (admin)
const updateSchema = z.object({
  message: z.string().min(1).max(200).optional(),
  isActive: z.boolean().optional(),
});

router.put("/admin/:id", requireAuth, async (req, res, next) => {
  try {
    const role = String(req.user?.role || "").toLowerCase();
    if (role !== "admin" && role !== "super-admin") {
      return res.status(403).json({ error: { message: "Forbidden: Admin access required" } });
    }

    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid payload", details: parsed.error.errors } });
    }

    const message = await FounderMessage.findByIdAndUpdate(
      req.params.id,
      { ...parsed.data, updatedAt: Date.now() },
      { new: true }
    );

    if (!message) {
      return res.status(404).json({ error: { message: "Message not found" } });
    }

    return res.json({ item: message });
  } catch (err) {
    return next(err);
  }
});

// DELETE message (admin)
router.delete("/admin/:id", requireAuth, async (req, res, next) => {
  try {
    const role = String(req.user?.role || "").toLowerCase();
    if (role !== "admin" && role !== "super-admin") {
      return res.status(403).json({ error: { message: "Forbidden: Admin access required" } });
    }

    const message = await FounderMessage.findByIdAndDelete(req.params.id);
    if (!message) {
      return res.status(404).json({ error: { message: "Message not found" } });
    }

    return res.json({ success: true, message: "Message deleted" });
  } catch (err) {
    return next(err);
  }
});

module.exports = { router, initializeMessages };
