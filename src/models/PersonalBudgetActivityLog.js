const mongoose = require("mongoose");
const { encryptField, decryptField } = require("../utils/encryption");

const PersonalBudgetActivityLogSchema = new mongoose.Schema(
  {
    profileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PersonalBudgetProfile",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    action: { type: String, required: true },
    recordType: { type: String, required: true },
    recordId: { type: mongoose.Schema.Types.ObjectId, required: true },
    oldValue: {
      type: String,
      get: (val) => {
        if (!val) return null;
        try {
          const dec = decryptField(val);
          return dec ? JSON.parse(dec) : null;
        } catch {
          return null;
        }
      },
      set: (val) => {
        if (val === undefined || val === null) return "";
        return encryptField(JSON.stringify(val));
      },
    },
    newValue: {
      type: String,
      get: (val) => {
        if (!val) return null;
        try {
          const dec = decryptField(val);
          return dec ? JSON.parse(dec) : null;
        } catch {
          return null;
        }
      },
      set: (val) => {
        if (val === undefined || val === null) return "";
        return encryptField(JSON.stringify(val));
      },
    },
  },
  {
    timestamps: { createdAt: "createdAt", updatedAt: false }, // only log created_at
    toJSON: { getters: true },
    toObject: { getters: true },
  }
);

module.exports = mongoose.model("PersonalBudgetActivityLog", PersonalBudgetActivityLogSchema);
