const mongoose = require("mongoose");
require("dotenv").config({ path: __dirname + "/../../.env" });

const CompanyReel = require("../models/CompanyReel");
const CompanyQuizQuestion = require("../models/CompanyQuizQuestion");

const SAMPLE_REELS = [
  {
    title: "Workplace Safety & PPE Standards",
    description: "Crucial personal protective equipment guidelines required before entering any active work zone.",
    duration: 24,
    mediaUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
    thumbnailUrl: "https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=800&q=80",
    category: "safety",
    isMandatory: true,
    priority: "urgent",
    dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
    applicableRoles: [],
    tags: ["safety", "ppe", "compliance", "mandatory"],
    quiz: {
      topic: "safety",
      question: "When entering active job site zones, which PPE items are strictly mandatory before starting work?",
      answerOptions: [
        { id: "opt_1", text: "High-visibility vest and sneakers" },
        { id: "opt_2", text: "Hard hat, safety glasses, high-visibility vest, and steel-toe boots" },
        { id: "opt_3", text: "Safety glasses only" },
        { id: "opt_4", text: "PPE is optional if the task takes less than 5 minutes" },
      ],
      correctAnswerId: "opt_2",
      explanation: "Company policy requires all personnel to wear hard hat, eye protection, hi-vis vest, and steel-toe footwear in all designated work zones.",
      difficulty: "medium",
      passFailConsequence: "reinforce",
    },
  },
  {
    title: "Clock-In, Lunch & Break Compliance",
    description: "Standard operating procedure for accurate shift logging, break status updates, and compliance.",
    duration: 20,
    mediaUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4",
    thumbnailUrl: "https://images.unsplash.com/photo-1506784983877-45594efa4cbe?w=800&q=80",
    category: "operations",
    isMandatory: true,
    priority: "high",
    dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days from now
    applicableRoles: [],
    tags: ["operations", "time-clock", "attendance", "lunch"],
    quiz: {
      topic: "operations",
      question: "What is the required action before starting your 30-minute lunch break?",
      answerOptions: [
        { id: "opt_1", text: "Send a text to a coworker only" },
        { id: "opt_2", text: "Update status to LUNCH on the Attendance tab and punch out" },
        { id: "opt_3", text: "Leave without recording if you return within 30 minutes" },
        { id: "opt_4", text: "Wait until the end of the day to add lunch manually" },
      ],
      correctAnswerId: "opt_2",
      explanation: "State labor regulations and company SOP require an active status update to LUNCH and recording lunch start time before taking the break.",
      difficulty: "easy",
      passFailConsequence: "reinforce",
    },
  },
  {
    title: "Customer Escalation & Service Excellence",
    description: "Proven de-escalation techniques when addressing customer feedback or on-site service disputes.",
    duration: 28,
    mediaUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4",
    thumbnailUrl: "https://images.unsplash.com/photo-1521737711867-e3b97375f902?w=800&q=80",
    category: "training",
    isMandatory: false,
    priority: "medium",
    dueDate: null,
    applicableRoles: [],
    tags: ["service", "communication", "sop"],
    quiz: {
      topic: "training",
      question: "When a customer expresses frustration on-site, what is the best initial response?",
      answerOptions: [
        { id: "opt_1", text: "Debate the contract terms immediately" },
        { id: "opt_2", text: "Listen attentively without interruption, empathize, and notify supervisor" },
        { id: "opt_3", text: "Instruct the customer to submit an online ticket and walk away" },
        { id: "opt_4", text: "Offer a random unauthorized discount" },
      ],
      correctAnswerId: "opt_2",
      explanation: "Active listening and professional empathy de-escalate tension and protect both customer trust and company standards.",
      difficulty: "medium",
      passFailConsequence: "reinforce",
    },
  },
  {
    title: "Cybersecurity & Device Lock Protocol",
    description: "Preventing data breaches: protocols for handling mobile workstations and sensitive employee files.",
    duration: 18,
    mediaUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyBlazes.mp4",
    thumbnailUrl: "https://images.unsplash.com/photo-1563986768609-322da13575f3?w=800&q=80",
    category: "compliance",
    isMandatory: true,
    priority: "medium",
    dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    applicableRoles: [],
    tags: ["security", "compliance", "privacy"],
    quiz: {
      topic: "compliance",
      question: "What must you do when stepping away from your workstation or mobile device?",
      answerOptions: [
        { id: "opt_1", text: "Lock the screen immediately (Win+L / power sleep)" },
        { id: "opt_2", text: "Leave it unlocked if stepping away for under 2 minutes" },
        { id: "opt_3", text: "Minimize windows only" },
        { id: "opt_4", text: "Turn off monitor display without locking" },
      ],
      correctAnswerId: "opt_1",
      explanation: "All unattended devices must be locked immediately to safeguard client and internal company data.",
      difficulty: "easy",
      passFailConsequence: "reinforce",
    },
  },
  {
    title: "Company Culture & The Se7en Standard",
    description: "Our core tenets: Extreme ownership, craft precision, and unwavering reliability across all teams.",
    duration: 25,
    mediaUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/WeAreGoingOnBullrun.mp4",
    thumbnailUrl: "https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800&q=80",
    category: "culture",
    isMandatory: false,
    priority: "medium",
    dueDate: null,
    applicableRoles: [],
    tags: ["culture", "values", "leadership"],
    quiz: {
      topic: "culture",
      question: "Which principle forms the heart of the Company Reels™ and Se7en standard?",
      answerOptions: [
        { id: "opt_1", text: "Speed over thoroughness" },
        { id: "opt_2", text: "Extreme ownership, precision, and respectful transparency" },
        { id: "opt_3", text: "Passing difficult responsibilities to others" },
        { id: "opt_4", text: "Minimum effort to complete shifts" },
      ],
      correctAnswerId: "opt_2",
      explanation: "Extreme ownership means taking full responsibility for the quality and safety of our deliverables.",
      difficulty: "easy",
      passFailConsequence: "reinforce",
    },
  },
];

async function seedCompanyReels() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is not set in environment.");
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log("[Seed] Connected to MongoDB");

  for (const item of SAMPLE_REELS) {
    const existing = await CompanyReel.findOne({ title: item.title });
    if (existing) {
      console.log(`[Seed] Reel "${item.title}" already exists, skipping.`);
      continue;
    }

    // 1. Create Question
    let quizDoc = null;
    if (item.quiz) {
      quizDoc = await CompanyQuizQuestion.create({
        topic: item.quiz.topic,
        question: item.quiz.question,
        answerOptions: item.quiz.answerOptions,
        correctAnswerId: item.quiz.correctAnswerId,
        explanation: item.quiz.explanation,
        difficulty: item.quiz.difficulty,
        passFailConsequence: item.quiz.passFailConsequence,
        status: "active",
      });
    }

    // 2. Create Reel
    const reelDoc = await CompanyReel.create({
      title: item.title,
      description: item.description,
      duration: item.duration,
      mediaUrl: item.mediaUrl,
      thumbnailUrl: item.thumbnailUrl,
      category: item.category,
      isMandatory: item.isMandatory,
      priority: item.priority,
      dueDate: item.dueDate,
      applicableRoles: item.applicableRoles,
      tags: item.tags,
      quizId: quizDoc ? quizDoc._id : null,
      status: "published",
    });

    if (quizDoc) {
      await CompanyQuizQuestion.findByIdAndUpdate(quizDoc._id, {
        linkedReelId: reelDoc._id,
      });
    }

    console.log(`[Seed] Created Reel: "${reelDoc.title}" (${reelDoc._id})`);
  }

  // 3. Seed Standard Curriculum Training Paths
  const CompanyTrainingPath = require("../models/CompanyTrainingPath");
  const allReels = await CompanyReel.find().lean();
  const reelMap = new Map(allReels.map((r) => [r.title, r]));

  const safetyReel = reelMap.get("Workplace Safety & PPE Standards");
  const clockReel = reelMap.get("Clock-In, Lunch & Break Compliance");
  const customerReel = reelMap.get("Customer Escalation & Service Excellence");
  const cyberReel = reelMap.get("Cybersecurity & Device Lock Protocol");
  const cultureReel = reelMap.get("Company Culture & The Se7en Standard");

  const PATHS = [
    {
      name: "Onboarding & Safety Foundation (Level 1)",
      description: "Mandatory Day-1 compliance track covering essential PPE, hazard identification, and clock procedures.",
      type: "onboarding",
      required: true,
      recurrenceRule: "once",
      items: [
        ...(safetyReel ? [{ reelId: safetyReel._id, sequenceOrder: 1, requiredQuizId: safetyReel.quizId, required: true }] : []),
        ...(clockReel ? [{ reelId: clockReel._id, sequenceOrder: 2, requiredQuizId: clockReel.quizId, required: true }] : []),
      ],
    },
    {
      name: "Operations & Service Excellence (Level 2)",
      description: "Customer de-escalation, conflict resolution, and quality craft standards required for full role certification.",
      type: "role",
      required: true,
      recurrenceRule: "once",
      items: [
        ...(customerReel ? [{ reelId: customerReel._id, sequenceOrder: 1, requiredQuizId: customerReel.quizId, required: true }] : []),
        ...(clockReel ? [{ reelId: clockReel._id, sequenceOrder: 2, requiredQuizId: clockReel.quizId, required: true }] : []),
      ],
    },
    {
      name: "Cybersecurity & Data Privacy (Level 3)",
      description: "Advanced protocol for securing client records, mobile workstations, and credentials.",
      type: "compliance",
      required: true,
      recurrenceRule: "annual",
      items: [
        ...(cyberReel ? [{ reelId: cyberReel._id, sequenceOrder: 1, requiredQuizId: cyberReel.quizId, required: true }] : []),
      ],
    },
    {
      name: "Leadership & Cultural Ownership (Level 4)",
      description: "Tenets of extreme ownership, leading field teams, and driving operational consistency.",
      type: "skill",
      required: false,
      recurrenceRule: "quarterly",
      items: [
        ...(cultureReel ? [{ reelId: cultureReel._id, sequenceOrder: 1, requiredQuizId: cultureReel.quizId, required: true }] : []),
      ],
    },
  ];

  for (const pathData of PATHS) {
    const existingPath = await CompanyTrainingPath.findOne({ name: pathData.name });
    if (!existingPath && pathData.items.length > 0) {
      const createdPath = await CompanyTrainingPath.create({
        ...pathData,
        status: "active",
      });
      console.log(`[Seed] Created Training Path: "${createdPath.name}" (${createdPath.items.length} items)`);
    }
  }

  console.log("[Seed] Company Reels™ seed finished successfully.");
  await mongoose.disconnect();
}

if (require.main === module) {
  seedCompanyReels().catch((err) => {
    console.error("[Seed] Error:", err);
    process.exit(1);
  });
}

module.exports = { seedCompanyReels };
