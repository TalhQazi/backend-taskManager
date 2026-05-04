const mongoose = require("mongoose");

const TeamLeadMappingSchema = new mongoose.Schema(
  {
    teamLead: { type: String, required: true, index: true },
    user: { type: String, required: true, index: true },
    allowOverrideAdminAssignments: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Drop old invalid index if it exists (fixes E11000 duplicate key error on null fields)
TeamLeadMappingSchema.index({ teamLead: 1, user: 1 }, { unique: true });

const TeamLeadMapping = mongoose.model("TeamLeadMapping", TeamLeadMappingSchema);

// This helper will drop the problematic index if it exists in the collection
TeamLeadMapping.collection.dropIndex("teamLeadId_1_userId_1").catch(() => {
  // Ignore error if index doesn't exist
});

module.exports = TeamLeadMapping;
