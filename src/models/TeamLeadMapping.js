const mongoose = require("mongoose");

const TeamLeadMappingSchema = new mongoose.Schema(
  {
    teamLead: { type: String, required: true, index: true },
    user: { type: String, required: true, index: true },
    allowOverrideAdminAssignments: { type: Boolean, default: false },
  },
  { timestamps: true }
);

TeamLeadMappingSchema.index({ teamLead: 1, user: 1 }, { unique: true });

module.exports = mongoose.model("TeamLeadMapping", TeamLeadMappingSchema);
