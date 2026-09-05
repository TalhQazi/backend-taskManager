const mongoose = require("mongoose");

const AnnouncementAcknowledgementSchema = new mongoose.Schema(
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
    acknowledgedAt: { type: Date, default: Date.now },
    confirmationText: { type: String, default: "" }, // typed "YES" confirmation
  },
  { timestamps: true }
);

AnnouncementAcknowledgementSchema.index(
  { announcementId: 1, userId: 1 },
  { unique: true }
);

module.exports = mongoose.model(
  "AnnouncementAcknowledgement",
  AnnouncementAcknowledgementSchema
);
