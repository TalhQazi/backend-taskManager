const mongoose = require("mongoose");

const JournalEntrySchema = new mongoose.Schema(
  {
    transactionDate: { type: Date, default: Date.now },
    reference: { type: String }, // Invoice #, Receipt #, etc.
    description: { type: String },
    lines: [
      {
        account: { type: mongoose.Schema.Types.ObjectId, ref: "AtlasAccount", required: true },
        debit: { type: Number, default: 0 },
        credit: { type: Number, default: 0 },
        memo: { type: String },
      },
    ],
    status: { type: String, enum: ["Draft", "Posted", "Void"], default: "Posted" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("JournalEntry", JournalEntrySchema);
