const mongoose = require("mongoose");

/**
 * EmployeeHRNote Schema
 * ─────────────────────
 * Confidential internal HR notes, performance reviews, and manager
 * commentary. Gated strictly behind HR/Admin role authorization.
 */
const EmployeeHRNoteSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
      index: true,
    },
    content: { type: String, required: true, trim: true },
    category: {
      type: String,
      enum: ["general", "performance", "disciplinary", "commendation", "compensation", "exit", "medical", "confidential"],
      default: "general",
      index: true,
    },
    isConfidential: { type: Boolean, default: false },
    authorUserId: { type: String, required: true },
    authorName: { type: String, default: "" },
    authorRole: { type: String, default: "" },
  },
  { timestamps: true }
);

EmployeeHRNoteSchema.index({ employeeId: 1, createdAt: -1 });

module.exports = mongoose.model("EmployeeHRNote", EmployeeHRNoteSchema);
