const mongoose = require("mongoose");

const OnboardingSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
    employeeName: { type: String, required: true },

    // Step 1: Basic Information Status
    basicInfo: {
      completed: { type: Boolean, default: false },
      email: { type: String },
      phone: { type: String },
      location: { type: String },
    },

    // Step 2: Identity Verification
    identityVerification: {
      primaryId: {
        idType: { type: String, enum: ["driver_license", "passport", "national_id"] },
        frontImage: { type: String }, // Base64 or URL
        backImage: { type: String }, // Base64 or URL
        status: { type: String, enum: ["missing", "submitted", "verified"], default: "missing" },
      },
      secondaryId: {
        idType: { type: String, enum: ["ss_card", "other"] },
        image: { type: String }, // Base64 or URL
        status: { type: String, enum: ["missing", "submitted", "verified"], default: "missing" },
      },
    },

    // Step 3: W-4 Form
    w4Form: {
      file: { type: String }, // Base64 or URL
      status: { type: String, enum: ["missing", "submitted", "verified"], default: "missing" },
    },

    // Step 4: Employee Handbook
    employeeHandbook: {
      acknowledged: { type: Boolean, default: false },
      signature: { type: String }, // Base64 or URL
      signedAt: { type: Date },
      status: { type: String, enum: ["missing", "submitted", "verified"], default: "missing" },
    },

    // Step 5: Digital Signature
    digitalSignature: {
      signature: { type: String }, // Base64 or URL
      status: { type: String, enum: ["missing", "submitted", "verified"], default: "missing" },
    },
    // Step 6: Work Information
   // Step 6: Work Information
workInfo: {
  completed: { type: Boolean, default: false },
  department: { type: String },
  jobTitle: { type: String },
  manager: { type: String },
  joinDate: { type: String }, // ← YEH ADD KARO
},

    // Overall Status
    overallStatus: {
      type: String,
      enum: ["not_started", "in_progress", "submitted", "approved", "rejected"],
      default: "not_started",
    },
    progress: { type: Number, default: 0 }, // 0-100

    // Admin Review
    adminReview: {
      reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      reviewedAt: { type: Date },
      comments: { type: String },
      rejectionReason: { type: String },
    },
  },
  { timestamps: true }
);

OnboardingSchema.index({ userId: 1 }, { unique: true });
OnboardingSchema.index({ employeeId: 1 });
OnboardingSchema.index({ overallStatus: 1 });

// Calculate progress before saving
OnboardingSchema.pre("save", function (next) {
  let completedSteps = 0;

  if (this.basicInfo.completed) completedSteps++;
  if ((this.identityVerification.primaryId.status === "submitted" || this.identityVerification.primaryId.status === "verified") &&
      (this.identityVerification.secondaryId.status === "submitted" || this.identityVerification.secondaryId.status === "verified")) completedSteps++;
  
  const hasW4 = this.w4Form.status === "submitted" || this.w4Form.status === "verified";
  if (hasW4) completedSteps++;
  
  if (this.employeeHandbook.status === "submitted" || this.employeeHandbook.status === "verified") completedSteps++;
  if (this.digitalSignature.status === "submitted" || this.digitalSignature.status === "verified") completedSteps++;
  if (this.workInfo?.completed) completedSteps++;

  const divisor = hasW4 ? 6 : 5;
  this.progress = Math.round((completedSteps / divisor) * 100);

  // Only auto-advance to in_progress — never auto-submit; submission requires explicit employee action
  if (this.overallStatus !== "submitted" && this.overallStatus !== "approved" && this.overallStatus !== "rejected") {
    if (this.progress > 0) {
      this.overallStatus = "in_progress";
    }
  }

  next();
});

module.exports = mongoose.model("Onboarding", OnboardingSchema);
