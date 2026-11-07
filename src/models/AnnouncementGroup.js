const mongoose = require("mongoose");

const AnnouncementGroupSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true, index: true },
    description: { type: String, default: "" },
    createdBy: { type: String, required: true, index: true }, // admin user id
    createdByName: { type: String, default: "" },

    // Group members defined by criteria
    members: [
      {
        type: String,
        enum: ["all-employees", "by-department", "by-team", "by-location", "by-role", "by-users"],
      },
    ],

    // Targeting rules
    departments: [{ type: String }], // department names
    teams: [{ type: String }], // team names
    locations: [{ type: String }], // location names
    roles: [{ type: String }], // role names
    userIds: [{ type: String }], // specific user IDs

    // Metadata
    isActive: { type: Boolean, default: true, index: true },
    memberCount: { type: Number, default: 0 },
    lastUsedAt: { type: Date, default: null },

    // Audit
    lastModifiedBy: { type: String, default: "" },
    lastModifiedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

AnnouncementGroupSchema.index({ createdBy: 1, isActive: 1 });
AnnouncementGroupSchema.index({ name: "text" });

module.exports = mongoose.model("AnnouncementGroup", AnnouncementGroupSchema);
