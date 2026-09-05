const mongoose = require("mongoose");

// Immutable record of every meaningful Cost Manager change.
const CostAuditLogSchema = new mongoose.Schema(
  {
    entityType: {
      type: String,
      required: true,
      enum: ["cost_sheet", "cost_section", "cost_line_item", "inventory_record", "certification_requirement"],
    },
    entityId: { type: String, required: true, index: true },
    projectId: { type: String, default: "", index: true },
    userId: { type: String, default: "" },
    username: { type: String, default: "" },
    action: { type: String, required: true }, // create | update | delete | status_change | payment
    oldValue: { type: mongoose.Schema.Types.Mixed, default: null },
    newValue: { type: mongoose.Schema.Types.Mixed, default: null },
    ipAddress: { type: String, default: "" },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

CostAuditLogSchema.index({ projectId: 1, createdAt: -1 });

module.exports = mongoose.model("CostAuditLog", CostAuditLogSchema);
