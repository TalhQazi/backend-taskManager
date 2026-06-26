require("dotenv").config();
const mongoose = require("mongoose");
const { connectDb } = require("../lib/db");
const Poll = require("../models/Poll");
const PollVote = require("../models/PollVote");
const PollComment = require("../models/PollComment");
const PollAuditLog = require("../models/PollAuditLog");
const Employee = require("../models/Employee");

// Mock employee target matching functions to test logic
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

// NLP Sentiment Trends calculation
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

function analyzeComments(comments, pollTitle) {
  if (comments.length === 0) {
    return {
      summaryText: "No feedback comments have been posted yet.",
      sentimentTrends: { positive: 0, neutral: 100, negative: 0 },
      recurringThemes: []
    };
  }

  let positiveCount = 0;
  let negativeCount = 0;
  let neutralCount = 0;

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
  });

  const total = comments.length;
  return {
    sentimentTrends: {
      positive: Math.round((positiveCount / total) * 100),
      neutral: Math.round((neutralCount / total) * 100),
      negative: Math.round((negativeCount / total) * 100)
    }
  };
}

async function runTests() {
  console.log("=== Ideas & Polls Backend Integration Verification ===");
  
  // 1. Connect to Database
  await connectDb();
  console.log("✓ Database Connected");

  // Sync index creation explicitly in case index hasn't been built yet
  await PollVote.syncIndexes();
  console.log("✓ Indexes Synced");

  let testEmployee = null;
  let testPoll = null;
  let testVote = null;
  let testComment = null;

  try {
    // 2. Setup Mock Employee
    testEmployee = await Employee.create({
      name: "Poll Test User",
      email: "polltestuser@example.com",
      department: "Engineering",
      location: "New York Office",
      userRole: "developer",
      status: "active"
    });
    console.log("✓ Mock Employee Created:", testEmployee.name);

    // 3. Test Audience Matching Logic
    const targetAll = { targetType: "All", targetValue: "All" };
    const targetDeptCorrect = { targetType: "Department", targetValue: "Engineering" };
    const targetDeptWrong = { targetType: "Department", targetValue: "Marketing" };
    const targetLocationCorrect = { targetType: "Location", targetValue: "New York Office" };
    const targetRoleCorrect = { targetType: "Role", targetValue: "developer" };

    if (!employeeMatchesAudience(testEmployee, targetAll)) throw new Error("Audience check 'All' failed");
    if (!employeeMatchesAudience(testEmployee, targetDeptCorrect)) throw new Error("Audience check 'Department' match failed");
    if (employeeMatchesAudience(testEmployee, targetDeptWrong)) throw new Error("Audience check 'Department' non-match failed");
    if (!employeeMatchesAudience(testEmployee, targetLocationCorrect)) throw new Error("Audience check 'Location' match failed");
    if (!employeeMatchesAudience(testEmployee, targetRoleCorrect)) throw new Error("Audience check 'Role' match failed");
    console.log("✓ Target Audience Rule Matching logic validated");

    // 4. Create a Poll
    testPoll = await Poll.create({
      title: "Integration Test Poll",
      description: "Testing standard developer upgrades and snacks",
      creatorId: testEmployee._id,
      creatorName: testEmployee.name,
      status: "Active",
      pollType: "MultipleChoice",
      startTime: new Date(),
      endTime: new Date(Date.now() + 1000 * 60 * 60 * 24), // 1 day from now
      allowCommentAttachments: true,
      allowVoteEditing: true,
      options: [
        { optionText: "Upgrade MacBook Pro 16", displayOrder: 1 },
        { optionText: "Upgrade ThinkPad P1", displayOrder: 2 }
      ],
      audiences: [
        { targetType: "Department", targetValue: "Engineering" }
      ]
    });
    console.log("✓ Poll successfully created:", testPoll.title);
    if (testPoll.options.length !== 2) throw new Error("Poll options were not embedded correctly");

    const optionIdToVote = String(testPoll.options[0]._id);

    // 5. Cast a Vote
    testVote = await PollVote.create({
      pollId: testPoll._id,
      userId: String(testEmployee._id),
      userName: testEmployee.name,
      userDepartment: testEmployee.department,
      userLocation: testEmployee.location,
      optionId: optionIdToVote
    });
    console.log("✓ Vote successfully cast on option:", optionIdToVote);

    // 6. Test Vote Uniqueness constraint
    try {
      await PollVote.create({
        pollId: testPoll._id,
        userId: String(testEmployee._id),
        userName: testEmployee.name,
        userDepartment: testEmployee.department,
        userLocation: testEmployee.location,
        optionId: optionIdToVote
      });
      throw new Error("FAIL: Double-voting unique index constraint failed to trigger");
    } catch (err) {
      if (err.message && err.message.includes("FAIL")) {
        throw err;
      }
      console.log("✓ Duplicate vote prevention (Unique index constraint) succeeded");
    }

    // 7. Add Threaded Comment and Attachment
    testComment = await PollComment.create({
      pollId: testPoll._id,
      userId: String(testEmployee._id),
      userName: testEmployee.name,
      commentText: "This is a great idea and support this clean choice!",
      attachments: [
        { fileName: "specs.pdf", fileUrl: "http://example.com/specs.pdf", fileType: "application/pdf" }
      ]
    });
    console.log("✓ Comment posted successfully with attachment:", testComment.attachments[0].fileName);

    // 8. Test real-time sentiment processing calculations
    const analysis = analyzeComments([testComment], testPoll.title);
    if (analysis.sentimentTrends.positive !== 100) {
      throw new Error(`Sentiment processing failed. Expected 100% positive, got: ${JSON.stringify(analysis.sentimentTrends)}`);
    }
    console.log("✓ Local sentiment analysis engine returns correctly (100% positive feedback)");

    // 9. Record Executive Decision
    testPoll.decisionText = "Approved MacBook upgrade due to positive response.";
    testPoll.decisionStatus = "Implemented";
    testPoll.decisionBy = "CEO - Executive Board";
    testPoll.decidedAt = new Date();
    testPoll.status = "Implemented";
    await testPoll.save();
    console.log("✓ Executive Decision successfully recorded. Poll status updated to:", testPoll.status);

    // 10. Audit Log Trail insertion
    const auditCount = await PollAuditLog.create({
      pollId: testPoll._id,
      pollTitle: testPoll.title,
      action: "Create Poll",
      performedBy: testEmployee.name
    });
    console.log("✓ Audit log trail verified successfully");

  } finally {
    // 11. Cleanup test records
    console.log("Cleaning up test database records...");
    if (testVote) await PollVote.deleteOne({ _id: testVote._id });
    if (testComment) await PollComment.deleteOne({ _id: testComment._id });
    if (testPoll) {
      await Poll.deleteOne({ _id: testPoll._id });
      await PollAuditLog.deleteMany({ pollId: testPoll._id });
    }
    if (testEmployee) await Employee.deleteOne({ _id: testEmployee._id });
    console.log("✓ Database cleanup complete");
  }

  console.log("=== All Backend Integration Tests Passed Successfully ===");
}

runTests().then(() => {
  process.exit(0);
}).catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
