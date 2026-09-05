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
    birthDate: { type: String, default: "" },
    joinDate: { type: Date },
    department: { type: String, default: "" },
    userRole: { type: String, default: "" },
    userStatus: { type: String, default: "active" },
    passwordHash: { type: String, default: "" },
    resetPasswordCode: { type: String, default: null },
    resetPasswordExpires: { type: Date, default: null },
    onboardingRequired: { type: Boolean, default: true },
    // Milestone fields
    lastMilestoneTriggered: { type: Date, default: null },
    milestoneLevel: { type: String, enum: ["30d", "90d", "6m", "1y", "2y", "3y", "4y", "5y", "6y", "7y", "8y", "9y", "10y"], default: null },
    milestoneOverlayActive: { type: Boolean, default: false },
    milestoneOverlayExpires: { type: Date, default: null },
    // Lunch/Break status fields
    current_status: { type: String, enum: ["AVAILABLE", "LUNCH", "BREAK"], default: "AVAILABLE" },
    lunch_start_time: { type: Date, default: null },
    lunch_expected_end: { type: Date, default: null },
    break_start_time: { type: Date, default: null },
    // Email notification preferences
    emailPreferences: {
      userRegistration: { type: Boolean, default: true },
      managerRegistration: { type: Boolean, default: true },
      forgotPassword: { type: Boolean, default: true },
      taskAssignment: { type: Boolean, default: true },
      fileAttachment: { type: Boolean, default: true },
      commentAdded: { type: Boolean, default: true },
      replyAdded: { type: Boolean, default: true },
      projectAssignment: { type: Boolean, default: true },
      projectReassignment: { type: Boolean, default: true },
    },
    // Extended Employee File Workspace Fields
    employeeNumber: { type: String, unique: true, sparse: true, index: true },
    legalName: { type: String, default: "" },
    preferredName: { type: String, default: "" },
    personalEmail: { type: String, default: "" },
    personalPhone: { type: String, default: "" },
    address: {
      street: { type: String, default: "" },
      city: { type: String, default: "" },
      state: { type: String, default: "" },
      zip: { type: String, default: "" },
      country: { type: String, default: "US" },
    },
    emergencyContacts: [
      {
        name: { type: String, default: "" },
        relationship: { type: String, default: "" },
        phone: { type: String, default: "" },
        email: { type: String, default: "" },
        isPrimary: { type: Boolean, default: false },
      },
    ],
    supervisorId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", default: null, index: true },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: "Location", default: null, index: true },
    rehireDate: { type: Date, default: null },
    separationDate: { type: Date, default: null },
    separationReason: { type: String, default: "" },
    separationType: {
      type: String,
      enum: ["resignation", "termination", "layoff", "retirement", "other", null],
      default: null,
    },
    compensation: {
      amount: { type: Number, default: 0 },
      type: { type: String, enum: ["hourly", "monthly", "annual"], default: "hourly" },
      currency: { type: String, default: "USD" },
      effectiveDate: { type: Date, default: null },
    },
  },
  { timestamps: true }
);

// Compound indexes for common queries
EmployeeSchema.index({ company: 1, status: 1 });
EmployeeSchema.index({ department: 1, status: 1 });
EmployeeSchema.index({ supervisorId: 1 });
EmployeeSchema.index({ createdAt: -1 });

module.exports = mongoose.model("Employee", EmployeeSchema);
