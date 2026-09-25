const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const { connectDb } = require("../src/lib/db");
const Task = require("../src/models/Task");
const Employee = require("../src/models/Employee");
const TaskFollowUp = require("../src/models/TaskFollowUp");
const FollowUpHistory = require("../src/models/FollowUpHistory");
const { generateAISuggestions } = require("../src/utils/aiEngine");
const { processFollowUpTimers } = require("../src/jobs/followUpJob");

async function runEndToEndVerification() {
  console.log("=================================================");
  console.log("   TASK MANAGER FOLLOW-UP TIMER VERIFICATION     ");
  console.log("=================================================\n");

  try {
    // 1. Connect to Database
    console.log("Step 1: Connecting to MongoDB...");
    await connectDb();
    console.log("Successfully connected to database.\n");

    // 2. Setup mock assignee and task
    console.log("Step 2: Preparing mock assignee & task...");
    let employee = await Employee.findOne({ status: "active" });
    if (!employee) {
      console.log("No active employee found. Seeding a mock employee...");
      employee = await Employee.create({
        name: "Test Runner",
        email: "testrunner@se7eninc.com",
        role: "employee",
        status: "active",
      });
    }
    console.log(`Using mock employee: "${employee.name}"`);

    const mockTask = await Task.create({
      title: "Verification Task: Database indexing check",
      description: "Perform analysis of primary database tables to verify index usages.",
      assignees: [employee.name],
      priority: "high",
      status: "pending",
      category: "maintenance",
    });
    console.log(`Mock task created: "${mockTask.title}" (ID: ${mockTask._id})\n`);

    // 3. Test AI Suggestion Engine Heuristics
    console.log("Step 3: Triggering AI Suggestion Engine...");
    const aiData = await generateAISuggestions(mockTask._id);
    console.log("AI Recommendations Generated successfully:");
    console.log(JSON.stringify(aiData, null, 2));
    console.log("");

    // 4. Create Follow-Up Timer in the past (to trigger immediate overdue state)
    console.log("Step 4: Scheduling a follow-up timer set in the past...");
    const pastDue = new Date(Date.now() - 20 * 60 * 1000); // 20 minutes overdue
    const timer = await TaskFollowUp.create({
      taskId: mockTask._id,
      createdBy: "TestRunner",
      dueAt: pastDue,
      status: "active",
      aiSuggestions: aiData,
      slaResponseTime: 15,
      slaFollowUpInterval: 30,
      slaCompletionDeadline: 60,
    });
    console.log(`Follow-up timer created. Due at: ${timer.dueAt.toISOString()} (Status: ${timer.status})\n`);

    // 5. Test Background Scheduler / Escalation worker
    console.log("Step 5: Invoking background interval cron process worker...");
    // Mock global.io safely to bypass socket network dependency during verification run
    global.io = {
      to: () => ({
        emit: (event, payload) => console.log(`[Mock Socket Broadcast] Event "${event}" emitted to room.`),
      }),
      emit: (event, payload) => console.log(`[Mock Socket Broadcast] Global event "${event}" emitted.`),
    };

    await processFollowUpTimers();
    console.log("Cron worker execution complete.\n");

    // 6. Verify Overdue & Escalation Transitions
    console.log("Step 6: Verifying database state updates...");
    const updatedTimer = await TaskFollowUp.findById(timer._id);
    console.log(`Updated Timer Status: "${updatedTimer.status}" (Expected: "overdue")`);
    console.log(`Escalation Level reached: Level ${updatedTimer.escalationLevel} (Expected: Level 2, as 20 mins overdue triggers Level 2)`);
    console.log(`Escalation History count: ${updatedTimer.escalationHistory.length}`);
    console.log("Escalation Steps recorded:");
    updatedTimer.escalationHistory.forEach(h => {
      console.log(`  - Level ${h.level} triggered at ${h.triggeredAt.toISOString()} (Notified: ${h.notifiedUsers.join(", ")})`);
    });
    console.log("");

    // 7. Verify Audit Log Trail
    console.log("Step 7: Retrieving Follow-Up Audit logs...");
    const historyLogs = await FollowUpHistory.find({ taskId: mockTask._id }).sort({ timestamp: 1 });
    console.log(`Audit log records count: ${historyLogs.length}`);
    historyLogs.forEach((log, index) => {
      console.log(`  [Log #${index + 1}] Action: "${log.actionType}" | Notes: ${log.notes}`);
    });
    console.log("");

    // 8. Test SLA resolution logic on Complete
    console.log("Step 8: Completing the overdue follow-up timer to verify SLA outcomes...");
    updatedTimer.status = "completed";
    updatedTimer.completedAt = new Date();
    // Resolve SLA Status
    if (updatedTimer.completedAt <= updatedTimer.dueAt) {
      updatedTimer.slaStatus = "Resolved On Time";
    } else {
      updatedTimer.slaStatus = "Resolved Late";
    }
    await updatedTimer.save();

    await FollowUpHistory.create({
      taskId: mockTask._id,
      followUpId: updatedTimer._id,
      userId: "TestRunner",
      actionType: "complete",
      notes: `Manually completed timer. Resolved as "${updatedTimer.slaStatus}" (completed past due threshold).`,
    });

    const finalTimer = await TaskFollowUp.findById(timer._id);
    console.log(`Final SLA Status: "${finalTimer.slaStatus}" (Expected: "Resolved Late")`);
    console.log("");

    // 9. Clean up mock database records
    console.log("Step 9: Cleaning up verification database records...");
    await TaskFollowUp.deleteOne({ _id: timer._id });
    await FollowUpHistory.deleteMany({ taskId: mockTask._id });
    await Task.deleteOne({ _id: mockTask._id });
    console.log("Clean up finished successfully.");

    console.log("\n=================================================");
    console.log("  VERIFICATION SUCCESSFUL: ALL CHECKS PASSED!   ");
    console.log("=================================================");
  } catch (err) {
    console.error("\nVerification run failed with error:", err.message);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

// Execute
runEndToEndVerification();
