const mongoose = require("mongoose");

async function connectDb() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not set");
  }

  mongoose.set("strictQuery", true);
  await mongoose.connect(uri);
}

module.exports = { connectDb };
