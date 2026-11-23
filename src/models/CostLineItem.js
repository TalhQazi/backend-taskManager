const mongoose = require("mongoose");

// Purchase status values per the Purchasing Progress Tracker spec.
const PURCHASE_STATUSES = [
  "not_purchased",
  "ready_to_buy",
  "partially_paid",
  "purchased",
  "shipped",
  "received",
  "stored",
  "delayed",
  "canceled",
];

// Build-readiness weight per status (planned 0% ... stored 90%, certified/completed 100%).
const READINESS_WEIGHTS = {
  not_purchased: 0,
  ready_to_buy: 10,
  partially_paid: 35,
  purchased: 50,
  shipped: 65,
  received: 80,
  stored: 90,
  delayed: 10,
  canceled: 0,
};

// Individual expense row. All money values stored as integer cents.
const CostLineItemSchema = new mongoose.Schema(
  {
    costSheetId: { type: mongoose.Schema.Types.ObjectId, ref: "CostSheet", required: true, index: true },
    costSectionId: { type: mongoose.Schema.Types.ObjectId, ref: "CostSection", required: true, index: true },
    projectId: { type: String, required: true, index: true },
    // Optional link back to a task so task expenses roll up into project totals.
    taskId: { type: String, default: "", index: true },

    itemName: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    expenseType: {
      type: String,
      enum: ["material", "manufacturing", "testing", "certification", "permit", "shipping", "tax", "lab", "packaging", "other"],
      default: "other",
    },

    qty: { type: Number, default: 1, min: 0 },
    unit: { type: String, default: "" },
    unitCostCents: { type: Number, default: 0, min: 0 },
    shippingCostCents: { type: Number, default: 0, min: 0 },
    taxCostCents: { type: Number, default: 0, min: 0 },
    otherFeesCents: { type: Number, default: 0, min: 0 },
    // Server-computed: qty * unitCost + shipping + tax + other fees.
    estimatedTotalCents: { type: Number, default: 0 },
    paidCents: { type: Number, default: 0, min: 0 },
    // Server-computed: estimatedTotal - paid, floored at zero.
    remainingCents: { type: Number, default: 0 },

    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", default: null },
    quoteNumber: { type: String, default: "" },

    purchaseStatus: { type: String, enum: PURCHASE_STATUSES, default: "not_purchased", index: true },
    priority: { type: String, enum: ["low", "medium", "high", "critical"], default: "medium" },
    requiredForPrototype: { type: Boolean, default: true },
    // Excluded items don't roll into projected totals (soft removal / canceled plans).
    isActive: { type: Boolean, default: true },

    // Physical storage location — required before an item may enter "stored" status.
    storage: {
      locationName: { type: String, default: "" },
      address: { type: String, default: "" },
      building: { type: String, default: "" },
      room: { type: String, default: "" },
      aisle: { type: String, default: "" },
      shelf: { type: String, default: "" },
      bin: { type: String, default: "" },
      qtyStored: { type: Number, default: 0 },
      notes: { type: String, default: "" },
      storedByUsername: { type: String, default: "" },
      storedAt: { type: Date, default: null },
    },

    // Quotes, invoices, receipts, spec sheets, lab reports, photos, tracking docs.
    attachments: [
      {
        fileName: { type: String, default: "" },
        url: { type: String, default: "" },
        mimeType: { type: String, default: "" },
        size: { type: Number, default: 0 },
        fileType: {
          type: String,
          enum: ["quote", "invoice", "receipt", "purchase_order", "spec_sheet", "safety_data_sheet", "lab_report", "photo", "tracking", "other"],
          default: "other",
        },
        uploadedByUsername: { type: String, default: "" },
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
    // Set once the purchased-but-not-stored alert fires so the cron doesn't repeat it.
    notStoredAlertSentAt: { type: Date, default: null },

    notes: { type: String, default: "" },
    createdByUserId: { type: String, default: "" },
    createdByUsername: { type: String, default: "" },
  },
  { timestamps: true }
);

CostLineItemSchema.index({ costSheetId: 1, costSectionId: 1 });

module.exports = mongoose.model("CostLineItem", CostLineItemSchema);
module.exports.PURCHASE_STATUSES = PURCHASE_STATUSES;
module.exports.READINESS_WEIGHTS = READINESS_WEIGHTS;
