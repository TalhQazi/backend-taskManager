const mongoose = require("mongoose");
const { encryptField, decryptField } = require("../utils/encryption");

const PersonalBudgetIncomeSourceSchema = new mongoose.Schema(
  {
    profileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PersonalBudgetProfile",
      required: true,
      index: true,
    },
    sourceName: {
      type: String,
      required: true,
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
    defaultAmount: {
      type: String,
      required: true,
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
    recurrenceRule: { type: String, default: "monthly" },
    active: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
    toObject: { getters: true },
  }
);

module.exports = mongoose.model("PersonalBudgetIncomeSource", PersonalBudgetIncomeSourceSchema);
