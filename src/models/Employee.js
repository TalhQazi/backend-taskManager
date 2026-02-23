const mongoose = require("mongoose");

const EmployeeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, default: "" },
    role: { type: String, default: "" },
    department: { type: String, default: "" },
    location: { type: String, default: "" },
    status: { type: String, enum: ["active", "away", "offline"], default: "active" },
    joinDate: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Employee", EmployeeSchema);
