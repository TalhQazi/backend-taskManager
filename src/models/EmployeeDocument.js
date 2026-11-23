const mongoose = require("mongoose");

/**
 * EmployeeDocument Schema
 * ───────────────────────
 * Manages category-tagged employee files in the Document Vault.
 * Supports metadata, sensitivity flags, expiration tracking,
 * versioning, and employee self-service visibility.
 */
const EmployeeDocumentSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    category: {
      type: String,
      enum: [
        "tax",
        "identity",
        "contracts",
        "compliance",
        "certification",
        "performance",
        "medical",
        "handbook",
        "other",
      ],
      default: "other",
      index: true,
    },
    sensitivity: {
      type: String,
      enum: ["standard", "confidential", "restricted"],
      default: "standard",
    },
    fileUrl: { type: String, required: true },
    fileType: { type: String, default: "" },
    fileSize: { type: Number, default: 0 },
    originalFileName: { type: String, default: "" },
    issueDate: { type: Date, default: null },
    expirationDate: { type: Date, default: null, index: true },
    version: { type: Number, default: 1 },
    previousVersionId: { type: mongoose.Schema.Types.ObjectId, ref: "EmployeeDocument", default: null },
    isArchived: { type: Boolean, default: false, index: true },
    employeeVisible: { type: Boolean, default: true },
    status: {
      type: String,
      enum: ["active", "expired", "archived", "pending_review"],
      default: "active",
      index: true,
    },
    tags: [{ type: String }],
    notes: { type: String, default: "" },
    uploadedBy: { type: String, default: "" },
    uploadedByName: { type: String, default: "" },
  },
  { timestamps: true }
);

EmployeeDocumentSchema.index({ employeeId: 1, category: 1, isArchived: 1 });
EmployeeDocumentSchema.index({ expirationDate: 1, status: 1 });

module.exports = mongoose.model("EmployeeDocument", EmployeeDocumentSchema);
