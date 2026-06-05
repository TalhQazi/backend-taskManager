const mongoose = require("mongoose");
const { encryptField, decryptField } = require("../utils/encryption");

const PersonalBudgetCategorySchema = new mongoose.Schema(
  {
    profileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PersonalBudgetProfile",
      required: true,
      index: true,
    },
    categoryName: {
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
    categoryType: { type: String, enum: ["bill", "income"], required: true },
    color: { type: String, default: "#cbd5e1" },
    icon: { type: String, default: "Folder" },
    isDefault: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
    toObject: { getters: true },
  }
);

module.exports = mongoose.model("PersonalBudgetCategory", PersonalBudgetCategorySchema);
