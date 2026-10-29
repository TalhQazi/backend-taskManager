const mongoose = require("mongoose");

const InvestorStatementSchema = new mongoose.Schema(
  {
    investorName: { type: String, required: true },
    period: { type: String, required: true },
    capitalContribution: { type: Number, default: 0 },
    distributionAmount: { type: Number, default: 0 },
    currentValue: { type: Number },
    roi: { type: Number },
    property: { type: mongoose.Schema.Types.ObjectId, ref: "Property" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("InvestorStatement", InvestorStatementSchema);
