const mongoose = require("mongoose");

const AtlasAccountSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    type: {
      type: String,
      enum: ["Asset", "Liability", "Equity", "Revenue", "Expense"],
      required: true,
    },
    subType: { type: String }, // e.g., Cash, Bank, Accounts Receivable
    description: { type: String },
    balance: { type: Number, default: 0 },
    currency: { type: String, default: "USD" },
    isActive: { type: Boolean, default: true },
    company: { type: mongoose.Schema.Types.ObjectId, ref: "Company" },
    companyLocation: { type: mongoose.Schema.Types.ObjectId, ref: "CompanyLocation" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AtlasAccount", AtlasAccountSchema);
