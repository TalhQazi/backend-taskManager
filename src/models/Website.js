const mongoose = require("mongoose");

const websiteSchema = new mongoose.Schema(
  {
    siteName: {
      type: String,
      required: true,
      trim: true,
    },
    url: {
      type: String,
      required: true,
      trim: true,
    },
    websiteType: {
      type: String,
      enum: ["active", "future"],
      required: true,
    },
    // For active websites
    platform: {
      type: String,
      default: "",
    },
    hostingProvider: {
      type: String,
      default: "",
    },
    loginEmail: {
      type: String,
      default: "",
    },
    loginPassword: {
      type: String,
      default: "",
    },
    status: {
      type: String,
      enum: ["Live", "Maintenance", "Development", "Offline"],
      default: "Development",
    },
    owner: {
      type: String,
      default: "",
    },
    notes: {
      type: String,
      default: "",
    },
    // For future websites
    projectName: {
      type: String,
      default: "",
    },
    domain: {
      type: String,
      default: "",
    },
    developmentStage: {
      type: String,
      enum: ["Concept", "Planning", "Design", "Development", "Testing", "Ready for Launch"],
      default: "Concept",
    },
    priority: {
      type: String,
      enum: ["Low", "Medium", "High", "Critical"],
      default: "Medium",
    },
    concept: {
      type: String,
      default: "",
    },
    // Common fields
    fileAttachments: [
      {
        fileName: String,
        fileUrl: String,
        uploadedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    createdBy: {
      type: String,
      default: "System",
    },
    launchDate: { type: Date },
    businessUnit: { type: String, default: "Marketing" }, // e.g. 'Marketing', 'SaaS', 'E-Commerce', 'Operations'
    environment: { type: String, default: "Production" }, // e.g. 'Production', 'Staging', 'Development'
    leadDeveloper: { type: String, default: "" }, // username
    complianceTemplate: { type: String, default: "" }, // template key
    readinessScore: { type: Number, default: 0 },
    overrideReason: { type: String, default: "" },
    // Core requirements checkmark fields
    largeHeaderImage: { type: String, enum: ["green", "red", "none"], default: "none" },
    contactInfoSection: { type: String, enum: ["green", "red", "none"], default: "none" },
    adaCompliance: { type: String, enum: ["green", "red", "none"], default: "none" },
    faq: { type: String, enum: ["green", "red", "none"], default: "none" },
    contactUsPage: { type: String, enum: ["green", "red", "none"], default: "none" },
    privacyPolicy: { type: String, enum: ["green", "red", "none"], default: "none" },
    seo: { type: String, enum: ["green", "red", "none"], default: "none" },
    siteMap: { type: String, enum: ["green", "red", "none"], default: "none" },
    stripeIntegration: { type: String, enum: ["green", "red", "none"], default: "none" },
    bugReportButton: { type: String, enum: ["green", "red", "none"], default: "none" },
    googleMaps: { type: String, enum: ["green", "red", "none"], default: "none" },
    appleMaps: { type: String, enum: ["green", "red", "none"], default: "none" },
    infoEmailSetup: { type: String, enum: ["green", "red", "none"], default: "none" },
    nathanEmailSetup: { type: String, enum: ["green", "red", "none"], default: "none" },
    // System Health Monitoring fields
    healthStatus: { type: String, enum: ["LIVE", "DEGRADED", "DOWN", "UNKNOWN"], default: "UNKNOWN" },
    lastCheckedAt: { type: Date },
    sslExpiryDate: { type: Date },
    sslIssuer: { type: String, default: "" },
    sslStatus: { type: String, enum: ["VALID", "EXPIRING_SOON", "EXPIRED", "INVALID", "UNKNOWN"], default: "UNKNOWN" },
    responseTimeMs: { type: Number, default: 0 },
    uptimePercentage: { type: Number, default: 100 },
    isMonitoringEnabled: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Website", websiteSchema);
