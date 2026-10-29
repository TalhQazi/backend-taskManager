const mongoose = require("mongoose");
const Task = require("./src/models/Task");
const CRMTask = require("./src/models/CRMTask");
const LegalTask = require("./src/models/LegalTask");

require("dotenv").config();

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not set in .env");
  }

  console.log("Connecting to MongoDB:", uri);
  await mongoose.connect(uri);
  console.log("Connected to MongoDB.");

  // Use current local date starting today at 00:00:00
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  console.log(`Cleaning task due dates that are before today (${today.toLocaleDateString()})...`);

  // 1. Clean normal Tasks (status not completed)
  const resultTasks = await Task.updateMany(
    {
      status: { $ne: "completed" },
      dueDate: { $exists: true, $ne: null, $lt: today }
    },
    {
      $unset: { dueDate: "" }
    }
  );
  console.log(`[Tasks] Cleared due date for ${resultTasks.modifiedCount} overdue tasks.`);

  // 2. Clean CRM Tasks (status not Completed)
  const resultCRMTasks = await CRMTask.updateMany(
    {
      status: { $ne: "Completed" },
      dueDate: { $exists: true, $ne: null, $lt: today }
    },
    {
      $unset: { dueDate: "" }
    }
  );
  console.log(`[CRMTasks] Cleared due date for ${resultCRMTasks.modifiedCount} overdue CRM tasks.`);

  // 3. Clean Legal Tasks (status not Done)
  const resultLegalTasks = await LegalTask.updateMany(
    {
      status: { $ne: "Done" },
      dueDate: { $exists: true, $ne: null, $lt: today }
    },
    {
      $unset: { dueDate: "" }
    }
  );
  console.log(`[LegalTasks] Cleared due date for ${resultLegalTasks.modifiedCount} overdue Legal tasks.`);

  await mongoose.disconnect();
  console.log("Disconnected from MongoDB.");
  console.log("Cleanup script completed successfully.");
}

run().catch((err) => {
  console.error("Cleanup failed:", err);
  process.exit(1);
});
