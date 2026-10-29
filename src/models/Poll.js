const mongoose = require("mongoose");

const PollSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, index: true },
    description: { type: String, default: "" },
    type: {
      type: String,
      enum: ["yes_no", "multiple_choice", "rating_1_10", "star_rating", "open_feedback"],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["draft", "scheduled", "active", "closed", "implemented", "rejected", "archived"],
      default: "draft",
      index: true,
    },
    scheduledAt: { type: Date, default: null, index: true },
    closesAt: { type: Date, default: null, index: true },
    allowEditUntilDeadline: { type: Boolean, default: true },
    allowComments: { type: Boolean, default: true },
    allowMultipleOptions: { type: Boolean, default: false },
    showResultsBeforeClose: { type: Boolean, default: false },

    creatorId: { type: String, required: true, index: true },
    creatorName: { type: String, default: "" },
    creatorRole: { type: String, default: "" },

    targetSummary: { type: String, default: "Everyone" },

    sendInApp: { type: Boolean, default: true },
    sendEmail: { type: Boolean, default: true },
    sendPush: { type: Boolean, default: false },
    sendSms: { type: Boolean, default: false },

    attachments: [
      {
        fileName: { type: String, default: "" },
        url: { type: String, default: "" },
        mimeType: { type: String, default: "" },
        size: { type: Number, default: 0 },
        uploadedAt: { type: Date, default: Date.now },
      },
    ],

    audienceCount: { type: Number, default: 0 },
    voteCount: { type: Number, default: 0 },
    commentCount: { type: Number, default: 0 },

    publishedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

PollSchema.index({ status: 1, closesAt: 1 });
PollSchema.index({ createdAt: -1 });
PollSchema.index({ title: "text", description: "text" });

module.exports = mongoose.model("Poll", PollSchema);
