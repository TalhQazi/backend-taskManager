const mongoose = require("mongoose");
const { encryptField, decryptField } = require("../utils/encryption");

const PersonalBudgetPeriodSchema = new mongoose.Schema(
  {
    profileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PersonalBudgetProfile",
      required: true,
      index: true,
    },
    month: { type: Number, required: true },
    year: { type: Number, required: true },
    status: { type: String, enum: ["active", "closed"], default: "active" },
    startingCash: {
      type: String,
      get: (val) => {
        if (!val) return 0;
        try {
          const dec = decryptField(val);
          return dec ? parseFloat(dec) : 0;
        } catch {
          return 0;
        }
      },
      set: (val) => {
        if (val === undefined || val === null) return "";
        return encryptField(String(val));
      },
    },
    notes: {
      type: String,
      get: (val) => {
        if (!val) return "";
        try {
          return decryptField(val) || "";
        } catch {
          return "";
        }
      },
      set: (val) => {
        if (!val) return "";
        return encryptField(String(val));
      },
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
    toObject: { getters: true },
  }
);

// Ensure unique month/year per profile
PersonalBudgetPeriodSchema.index({ profileId: 1, month: 1, year: 1 }, { unique: true });

module.exports = mongoose.model("PersonalBudgetPeriod", PersonalBudgetPeriodSchema);
