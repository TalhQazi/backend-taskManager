const mongoose = require("mongoose");

const ExpenseSheetSchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true },
    title: { type: String, required: true },
    description: { type: String, default: "" },
    status: { type: String, enum: ["draft", "active", "completed", "cancelled"], default: "draft" },
    createdBy: { type: String, default: "" }, // username
  },
  { timestamps: true }
);

ExpenseSheetSchema.index({ projectId: 1 });
ExpenseSheetSchema.index({ createdAt: -1 });

module.exports = mongoose.model("ExpenseSheet", ExpenseSheetSchema);
