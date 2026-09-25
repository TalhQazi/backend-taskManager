const mongoose = require("mongoose");

const crmBehavioralEventSchema = new mongoose.Schema(
  {
    contactId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CRMContact",
      required: true,
      index: true,
    },
    eventType: {
      type: String,
      required: true,
      enum: ["email_open", "site_visit", "proposal_view", "call_duration", "sms_reply"],
      index: true,
    },
    description: {
      type: String,
      trim: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("CRMBehavioralEvent", crmBehavioralEventSchema);
