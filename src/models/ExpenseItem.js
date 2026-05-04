const mongoose = require("mongoose");

const ExpenseItemSchema = new mongoose.Schema(
  {
    sheetId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ExpenseSheet",
      required: true,
    },

    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
    },

    phase: {
      type: String,
      enum: ["concept", "design", "prototype", "testing", "manufacturing", "deployment"],
      default: "concept",
    },

    type: {
      type: String,
      enum: ["material", "service", "labor", "misc"],
      default: "material",
    },

    // BASIC INFO
    itemName: { type: String, required: true },
    description: String,
    notes: String,

    // ✅ VENDOR RELATION (IMPORTANT)
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
    },

    // fallback (optional)
    vendorName: String,

    // PART DETAILS
    partNumber: String,
    sku: String,

    // COSTING
    quantity: { type: Number, default: 1 },
    unitCost: { type: Number, default: 0 },

    estimatedCost: { type: Number, default: 0 },
    actualCost: { type: Number, default: 0 },

    totalCost: { type: Number, default: 0 },

    // LINKED TASK
    linkedTaskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Task",
    },

    // LABOR
    isLabor: { type: Boolean, default: false },
    hours: { type: Number, default: 0 },
    hourlyRate: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// AUTO CALCULATION
ExpenseItemSchema.pre("save", function (next) {
  if (this.isLabor) {
    this.totalCost = this.hours * this.hourlyRate;
    this.actualCost = this.totalCost;
  } else {
    this.totalCost = this.quantity * this.unitCost;
  }
  next();
});

module.exports =
  mongoose.models.ExpenseItem ||
  mongoose.model("ExpenseItem", ExpenseItemSchema);