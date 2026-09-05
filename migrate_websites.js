const mongoose = require("mongoose");
const dns = require("dns");
dns.setServers(["8.8.8.8", "1.1.1.1"]);
dns.setDefaultResultOrder("ipv4first");

const Website = require("./src/models/Website");
require("dotenv").config();

async function run() {
  const uri = process.env.MONGODB_URI;
  console.log("Connecting to MongoDB:", uri);
  await mongoose.connect(uri);
  console.log("Connected to MongoDB.");

  // Update websites missing the isMonitoringEnabled field
  const result = await Website.updateMany(
    { isMonitoringEnabled: { $exists: false } },
    { $set: { isMonitoringEnabled: true } }
  );

  console.log(`Migration completed. Matched ${result.matchedCount} and modified ${result.modifiedCount} websites.`);

  await mongoose.disconnect();
  console.log("Disconnected.");
}

run().catch(err => {
  console.error("Migration failed:", err);
  process.exit(1);
});
