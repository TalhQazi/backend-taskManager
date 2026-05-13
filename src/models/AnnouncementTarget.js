const mongoose = require("mongoose");

const AnnouncementTargetSchema = new mongoose.Schema(
  {
    announcementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Announcement",
      required: true,
      index: true,
    },
    targetType: {
      type: String,
      enum: ["global", "department", "team", "location", "role", "user", "company"],
      required: true,
    },
    targetId: { type: String, default: "" }, // e.g. department name, location name, username, role
    targetLabel: { type: String, default: "" }, // human-readable label
  },
  { timestamps: true }
);

AnnouncementTargetSchema.index({ announcementId: 1, targetType: 1 });

module.exports = mongoose.model("AnnouncementTarget", AnnouncementTargetSchema);
