const mongoose = require("mongoose");

const ExpenseSheetSchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true },
    name: { type: String, required: true },
    createdBy: String,
    status: {
      type: String,
      enum: ["draft", "submitted", "approved", "rejected"],
      default: "draft",
    },
    totalAmount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// ✅ SAFE EXPORT
module.exports =
  mongoose.models.ExpenseSheet ||
  mongoose.model("ExpenseSheet", ExpenseSheetSchema);