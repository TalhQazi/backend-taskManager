const mongoose = require("mongoose");

// One cost sheet per project (Project Cost Manager™).
// All money values are stored as integer cents to avoid floating point errors.
const CostSheetSchema = new mongoose.Schema(
  {
    projectId: { type: String, required: false, index: true },
    taskId: { type: String, required: false, index: true },
    name: { type: String, default: "Project Cost Sheet" },
    currency: { type: String, default: "USD" },
    // Manual entry: money currently available for purchasing.
    availableBudgetCents: { type: Number, default: 0 },
    // True while a projected-cost-exceeds-budget alert is outstanding (prevents repeats).
    budgetAlertActive: { type: Boolean, default: false },
    createdByUserId: { type: String, default: "" },
    createdByUsername: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("CostSheet", CostSheetSchema);
