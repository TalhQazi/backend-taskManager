const mongoose = require("mongoose");

const crmCommunicationSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["Email", "SMS", "Call", "Note"],
      required: true,
      trim: true,
    },
    sender: {
      type: String,
      required: true,
      trim: true,
    },
    receiver: {
      type: String,
      required: true,
      trim: true,
    },
    content: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      required: true,
      trim: true,
    },
    date: {
      type: Date,
      default: Date.now,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  }
);

crmCommunicationSchema.index({ date: -1 });
crmCommunicationSchema.index({ type: 1 });
crmCommunicationSchema.index({ sender: 1 });
crmCommunicationSchema.index({ receiver: 1 });

module.exports = mongoose.model("CRMCommunication", crmCommunicationSchema);
