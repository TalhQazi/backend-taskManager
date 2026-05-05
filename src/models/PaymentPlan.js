const mongoose = require("mongoose");

const paymentPlanSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    propertyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },

    totalBalance: { type: Number, required: true, min: 0 },
    remainingBalance: { type: Number, required: true, min: 0 },

    status: {
      type: String,
      enum: ["draft", "active", "completed", "defaulted"],
      default: "draft",
      index: true,
    },

    agreementNotes: { type: String, default: "" },

    createdBy: { type: String, default: "" },
  },
  { timestamps: true }
);

paymentPlanSchema.index({ tenantId: 1, propertyId: 1, createdAt: -1 });

module.exports = mongoose.model("PaymentPlan", paymentPlanSchema);
