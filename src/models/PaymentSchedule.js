const mongoose = require("mongoose");

const paymentScheduleSchema = new mongoose.Schema(
  {
    planId: { type: mongoose.Schema.Types.ObjectId, ref: "PaymentPlan", required: true, index: true },

    paymentNumber: { type: Number, required: true, min: 1 },
    dueDate: { type: String, required: true },
    dueTime: { type: String, default: "" },
    amount: { type: Number, required: true, min: 0 },

    status: {
      type: String,
      enum: ["pending", "paid", "missed"],
      default: "pending",
      index: true,
    },

    paidAt: { type: Date, default: null },
    notified: { type: Boolean, default: false },
    notifiedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

paymentScheduleSchema.index({ planId: 1, paymentNumber: 1 }, { unique: true });
paymentScheduleSchema.index({ dueDate: 1, status: 1 });
paymentScheduleSchema.index({ status: 1, notified: 1, dueDate: 1 });

module.exports = mongoose.model("PaymentSchedule", paymentScheduleSchema);
