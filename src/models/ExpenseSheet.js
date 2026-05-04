const mongoose = require("mongoose");

const ExpenseSheetSchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true },
    name: { type: String, required: true },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    status: {
      type: String,
      enum: ["draft", "submitted", "approved", "rejected"],
      default: "draft",
    },

    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    approvedAt: Date,
    rejectionReason: String,

    totalAmount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// ✅ SAFE EXPORT
module.exports =
  mongoose.models.ExpenseSheet ||
  mongoose.model("ExpenseSheet", ExpenseSheetSchema);