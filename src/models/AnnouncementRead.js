const mongoose = require("mongoose");

const AnnouncementReadSchema = new mongoose.Schema(
  {
    announcementId: { type: mongoose.Schema.Types.ObjectId, ref: "Announcement", required: true },
    userId: { type: String, required: true },
    userName: { type: String, default: "" },
    userRole: { type: String, default: "" },
    readAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true }
);

AnnouncementReadSchema.index({ announcementId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model("AnnouncementRead", AnnouncementReadSchema);
