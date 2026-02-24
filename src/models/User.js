const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, default: "" },
    email: { type: String, default: "" },
    username: { type: String, required: true, unique: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, required: true, enum: ["admin", "manager", "employee"] },
    status: { type: String, default: "active" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", UserSchema);
