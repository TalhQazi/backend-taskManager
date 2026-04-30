const mongoose = require("mongoose");

const ExpenseItemSchema = new mongoose.Schema(
  {
    sheetId: { type: mongoose.Schema.Types.ObjectId, ref: "ExpenseSheet", required: true },
    itemName: { type: String, required: true },
    description: String,
    vendor: String,
    quantity: { type: Number, default: 1 },
    unitPrice: { type: Number, default: 0 },
    totalPrice: { type: Number, default: 0 },
    category: String,
  },
  { timestamps: true }
);

ExpenseItemSchema.pre("save", function (next) {
  this.totalPrice = this.quantity * this.unitPrice;
  next();
});

// ✅ FIX
module.exports =
  mongoose.models.ExpenseItem ||
  mongoose.model("ExpenseItem", ExpenseItemSchema);