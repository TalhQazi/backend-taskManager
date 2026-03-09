const mongoose = require("mongoose");

const EmployeeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    initials: { type: String, default: "" },
    email: { type: String, required: true },
    phone: { type: String, default: "" },
    category: { type: String, default: "" },
    role: { type: String, default: "" },
    company: { type: String, default: "" },
    location: { type: String, default: "" },
    status: { type: String, enum: ["active", "inactive", "on-leave"], default: "active" },
    payRate: { type: String, default: "" },
    shift: { type: String, default: "" },
    hireDate: { type: String, default: "" },
    joinDate: { type: Date },
    passwordHash: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Employee", EmployeeSchema);
