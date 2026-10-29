const mongoose = require("mongoose");

const PersonalBudgetProfileSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    displayName: { type: String, default: "" },
    defaultCurrency: { type: String, default: "USD" },
    privacyMode: { type: String, enum: ["private", "shared"], default: "private" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PersonalBudgetProfile", PersonalBudgetProfileSchema);
