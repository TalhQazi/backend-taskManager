const bcrypt = require("bcryptjs");
require("dotenv").config();

const { connectDb } = require("./lib/db");
const User = require("./models/User");

async function seedUser({ username, password, role }) {
  const existing = await User.findOne({ username }).lean();
  if (existing) return;

  const passwordHash = await bcrypt.hash(password, 10);
  await User.create({ username, passwordHash, role });
}

async function main() {
  await connectDb();

  await seedUser({ username: "admin", password: "admin123", role: "admin" });
  await seedUser({ username: "manager", password: "manager123", role: "manager" });

 
  console.log("Seed complete");
  process.exit(0);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
