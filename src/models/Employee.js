const mongoose = require("mongoose");

const EmployeeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, index: true },
    initials: { type: String, default: "" },
    email: { type: String, required: true, index: true },
    phone: { type: String, default: "" },
    category: { type: String, default: "" },
    role: { type: String, default: "" },
    company: { type: String, default: "" },
    location: { type: String, default: "" },
    status: { type: String, enum: ["active", "inactive", "on-leave"], default: "active", index: true },
    payType: { type: String, enum: ["hourly", "monthly"], default: "hourly" },
    payRate: { type: String, default: "" },
    shift: { type: String, default: "" },
    hireDate: { type: String, default: "" },
    joinDate: { type: Date },
    passwordHash: { type: String, default: "" },
    address: { type: String, default: "" },

emergencyContact: {
  name: { type: String, default: "" },
  phone: { type: String, default: "" },
  relation: { type: String, default: "" },
},

bankInfo: {
  accountName: { type: String, default: "" },
  accountNumber: { type: String, default: "" }, // encrypt later
  ifsc: { type: String, default: "" },
  bankName: { type: String, default: "" },
},

taxSettings: {
  withholdingStatus: { type: String, default: "" },
  extraWithholding: { type: Number, default: 0 },
},
  },
  { timestamps: true }
);

// Compound indexes for common queries
EmployeeSchema.index({ company: 1, status: 1 });
EmployeeSchema.index({ createdAt: -1 });

module.exports = mongoose.model("Employee", EmployeeSchema);
