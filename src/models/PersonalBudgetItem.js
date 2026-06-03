const mongoose = require("mongoose");
const { encryptField, decryptField } = require("../utils/encryption");

const PersonalBudgetItemSchema = new mongoose.Schema(
  {
    periodId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PersonalBudgetPeriod",
      required: true,
      index: true,
    },
    profileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PersonalBudgetProfile",
      required: true,
      index: true,
    },
    itemType: {
      type: String,
      enum: ["bill", "income", "transfer"],
      required: true,
      index: true,
    },
    name: {
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
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PersonalBudgetCategory",
      required: true,
      index: true,
    },
    amountPlanned: {
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
    amountActual: {
      type: String,
      default: "",
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
    dueDate: { type: Date, required: true },
    status: { type: String, required: true },
    recurrenceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PersonalBudgetRecurrence",
      default: null,
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
    sortOrder: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
    toObject: { getters: true },
  }
);

module.exports = mongoose.model("PersonalBudgetItem", PersonalBudgetItemSchema);
