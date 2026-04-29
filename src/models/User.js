const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, default: "" },
    email: { type: String, default: "", index: true },
    username: { type: String, required: true, unique: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, required: true, enum: ["super-admin", "admin", "manager", "developer", "employee"], index: true },
    status: { type: String, default: "active", index: true },
    mfaEnabled: { type: Boolean, default: false },
    mfaSecret: { type: String, default: "" },
  },
  { timestamps: true }
);

UserSchema.index({ role: 1, status: 1 });

module.exports = mongoose.model("User", UserSchema);
