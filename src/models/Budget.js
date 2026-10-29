const mongoose = require("mongoose");

const BudgetSchema = new mongoose.Schema(
  {
    fiscalYear: { type: String, required: true },
    account: { type: mongoose.Schema.Types.ObjectId, ref: "AtlasAccount", required: true },
    allocatedAmount: { type: Number, required: true },
    actualSpent: { type: Number, default: 0 },
    period: { type: String, enum: ["Monthly", "Quarterly", "Annual"], default: "Annual" },
    description: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Budget", BudgetSchema);
