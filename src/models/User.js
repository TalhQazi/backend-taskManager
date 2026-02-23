const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, required: true, enum: ["admin", "manager"] },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", UserSchema);
