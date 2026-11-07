const mongoose = require("mongoose");

const AnnouncementReadSchema = new mongoose.Schema(
  {
    announcementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Announcement",
      required: true,
      index: true,
    },
    userId: { type: String, required: true, index: true },
    userName: { type: String, default: "" },
    userRole: { type: String, default: "" },
    readAt: { type: Date, default: Date.now },
    deviceType: { type: String, default: "" }, // e.g. "desktop", "mobile"
  },
  { timestamps: true }
);

AnnouncementReadSchema.index({ announcementId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model("AnnouncementRead", AnnouncementReadSchema);
