const mongoose = require("mongoose");

const AnnouncementAcknowledgementSchema = new mongoose.Schema(
  {
    announcementId: { type: mongoose.Schema.Types.ObjectId, ref: "Announcement", required: true },
    userId: { type: String, required: true },
    userName: { type: String, default: "" },
    acknowledgedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true }
);

AnnouncementAcknowledgementSchema.index({ announcementId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model("AnnouncementAcknowledgement", AnnouncementAcknowledgementSchema);
