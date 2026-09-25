const mongoose = require("mongoose");

const AtlasTransactionSchema = new mongoose.Schema(
  {
    date: { type: Date, default: Date.now },
    type: { type: String, enum: ["Income", "Expense"], required: true },
    category: { type: String }, // e.g., Maintenance, Rent, Utility
    amount: { type: Number, required: true },
    account: { type: mongoose.Schema.Types.ObjectId, ref: "AtlasAccount", required: true },
    company: { type: mongoose.Schema.Types.ObjectId, ref: "Company" },
    companyLocation: { type: mongoose.Schema.Types.ObjectId, ref: "CompanyLocation" },
    property: { type: mongoose.Schema.Types.ObjectId, ref: "Property" },
    unit: { type: mongoose.Schema.Types.ObjectId, ref: "Unit" },
    description: { type: String },
    paymentMethod: { type: String, enum: ["Cash", "Bank Transfer", "Credit Card", "Check"], default: "Bank Transfer" },
    reference: { type: String },
    journalEntry: { type: mongoose.Schema.Types.ObjectId, ref: "JournalEntry" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AtlasTransaction", AtlasTransactionSchema);
