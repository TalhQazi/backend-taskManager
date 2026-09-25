const mongoose = require("mongoose");

const QuoteSchema = new mongoose.Schema({
  vendorName: { type: String, required: true },
  amountCents: { type: Number, required: true },
  notes: { type: String, default: "" },
  isSelected: { type: Boolean, default: false },
});

const ExpenseItemSchema = new mongoose.Schema(
  {
    expenseSheetId: { type: mongoose.Schema.Types.ObjectId, ref: "ExpenseSheet", required: true },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project" },
    phase: { type: String, default: "" },
    itemName: { type: String, required: true },
    partNumber: { type: String, default: "" },
    vendorName: { type: String, default: "" }, // Legacy / Fallback vendor
    estimatedTotalCents: { type: Number, default: 0 },
    paidCents: { type: Number, default: 0 },
    purchaseStatus: { type: String, default: "pending" },
    quotes: [QuoteSchema],
  },
  { timestamps: true }
);

ExpenseItemSchema.index({ expenseSheetId: 1 });
ExpenseItemSchema.index({ projectId: 1 });
ExpenseItemSchema.index({ phase: 1 });

module.exports = mongoose.model("ExpenseItem", ExpenseItemSchema);
