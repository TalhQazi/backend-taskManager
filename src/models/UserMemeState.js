const mongoose = require("mongoose");

const UserMemeStateSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true, index: true },
    lastMemeTimestamp: { type: Date, default: null, index: true },
    nextMemeTimestamp: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

UserMemeStateSchema.index({ userId: 1 });

module.exports = mongoose.model("UserMemeState", UserMemeStateSchema);

