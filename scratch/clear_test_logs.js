const mongoose = require("mongoose");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config({ path: path.join(__dirname, "../.env") });

const ActivityLog = require("../src/models/ActivityLog");
const Employee = require("../src/models/Employee");

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI not set");
    process.exit(1);
  }
  await mongoose.connect(uri);
  console.log("Connected to MongoDB");

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);

  const userId = "69e1edf7fbc0a25c077a9202"; // Mr. Malik

  // Reset employee current status to AVAILABLE and clear any active times
  await Employee.findByIdAndUpdate(userId, {
    current_status: "AVAILABLE",
    lunch_start_time: null,
    lunch_expected_end: null,
    break_start_time: null
  });
  console.log("Employee status reset to AVAILABLE");

  // Delete today's start_break and end_break for Mr. Malik so he can test "Go on Break"
  const result = await ActivityLog.deleteMany({
    actorUserId: userId,
    action: { $in: ["start_break", "end_break"] },
    createdAt: { $gte: startOfToday, $lte: endOfToday }
  });

  console.log(`Deleted ${result.deletedCount} break logs for today.`);
  await mongoose.disconnect();
}

run().catch(console.error);
