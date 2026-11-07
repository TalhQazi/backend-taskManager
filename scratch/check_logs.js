const mongoose = require("mongoose");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config({ path: path.join(__dirname, "../.env") });

const ActivityLog = require("../src/models/ActivityLog");

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

  const logs = await ActivityLog.find({
    createdAt: { $gte: startOfToday, $lte: endOfToday }
  }).sort({ createdAt: -1 }).lean();

  console.log(`Found ${logs.length} logs for today:`);
  for (const log of logs) {
    console.log(`- Time: ${log.createdAt.toISOString()}, Actor: ${log.actorUsername} (${log.actorUserId}), Action: ${log.action}, Resource: ${log.resourceName} (${log.resourceId})`);
  }

  await mongoose.disconnect();
}

run().catch(console.error);
