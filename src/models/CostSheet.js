const mongoose = require("mongoose");

// One cost sheet per project (Project Cost Manager™).
// All money values are stored as integer cents to avoid floating point errors.
const CostSheetSchema = new mongoose.Schema(
  {
    projectId: { type: String, required: false, index: true },
    taskId: { type: String, required: false, index: true },
    name: { type: String, default: "Project Cost Sheet" },
    vendorName: { type: String, default: "" },
    quoteNumber: { type: String, default: "" },
    isQuote: { type: Boolean, default: false },
    quoteStatus: { type: String, enum: ["draft", "submitted", "accepted", "rejected", "archived"], default: "draft" },
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

const CostSheet = mongoose.model("CostSheet", CostSheetSchema);

async function ensureCostSheetIndexes() {
  try {
    const indexes = await CostSheet.collection.indexes();
    for (const idx of indexes) {
      if (idx.name !== "_id_" && idx.unique && (idx.key?.projectId || idx.key?.taskId)) {
        await CostSheet.collection.dropIndex(idx.name).catch(() => {});
      }
    }
    await CostSheet.syncIndexes();
  } catch (err) {
    console.error("[CostSheet] index sync failed:", err.message);
  }
}

if (mongoose.connection.readyState === 1) {
  void ensureCostSheetIndexes();
} else {
  mongoose.connection.once("open", () => {
    void ensureCostSheetIndexes();
  });
}

CostSheet.ensureCostSheetIndexes = ensureCostSheetIndexes;
module.exports = CostSheet;
