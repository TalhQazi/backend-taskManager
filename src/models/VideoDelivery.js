const mongoose = require("mongoose");

const VideoDeliverySchema = new mongoose.Schema(
  {
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true, index: true },
    videoMessageId: { type: mongoose.Schema.Types.ObjectId, ref: "VideoMessage", required: true, index: true },
    messageType: {
      type: String,
      enum: [
        "birthday",
        "30d",
        "6m",
        "1y",
        "2y",
        "3y",
        "4y",
        "5y",
        "6y",
        "7y",
        "8y",
        "9y",
        "10y",
        "top-performer",
      ],
      required: true,
      index: true,
    },
    deliveredAt: { type: Date, default: Date.now, index: true },
    acknowledgedAt: { type: Date, default: null },
    watchDuration: { type: Number, default: 0 },
    response: { type: String, default: "" },
    replayCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

VideoDeliverySchema.index({ employeeId: 1, messageType: 1, deliveredAt: 1 });

module.exports = mongoose.model("VideoDelivery", VideoDeliverySchema);
