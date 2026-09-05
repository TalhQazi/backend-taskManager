const mongoose = require("mongoose");

const UserMemeStateSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true },
    lastMemeTimestamp: { type: Date, default: null, index: true },
    nextMemeTimestamp: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("UserMemeState", UserMemeStateSchema);

