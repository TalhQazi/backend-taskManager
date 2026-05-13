const mongoose = require("mongoose");

const AnnouncementTargetSchema = new mongoose.Schema(
  {
    announcementId: { type: mongoose.Schema.Types.ObjectId, ref: "Announcement", required: true },
    targetType: { type: String, default: "global" },
    targetId: { type: String, default: "" },
    targetLabel: { type: String, default: "" },
  },
  { timestamps: true }
);

AnnouncementTargetSchema.index({ announcementId: 1 });

module.exports = mongoose.model("AnnouncementTarget", AnnouncementTargetSchema);
