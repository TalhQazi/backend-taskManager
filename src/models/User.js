const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, default: "" },
    email: { type: String, default: "", index: true },
    username: { type: String, required: true, unique: true, trim: true },
    passwordHash: { type: String, default: "" },
    role: { type: String, required: true, enum: ["super-admin", "admin", "manager", "team-lead", "developer", "employee", "coder"], index: true },
    status: { type: String, default: "active", index: true },
    resetPasswordCode: { type: String, default: null },
    resetPasswordExpires: { type: Date, default: null },
  },
  { timestamps: true }
);

UserSchema.index({ role: 1, status: 1 });

module.exports = mongoose.model("User", UserSchema);
