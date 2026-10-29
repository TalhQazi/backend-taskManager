const mongoose = require("mongoose");

const InvoiceSchema = new mongoose.Schema(
  {
    customerName: { type: String, required: true },
    tenant: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant" },
    company: { type: mongoose.Schema.Types.ObjectId, ref: "Company" },
    companyLocation: { type: mongoose.Schema.Types.ObjectId, ref: "CompanyLocation" },
    invoiceNumber: { type: String, required: true, unique: true },
    date: { type: Date, default: Date.now },
    dueDate: { type: Date },
    amount: { type: Number, required: true },
    status: { type: String, enum: ["Draft", "Sent", "Paid", "Void", "Overdue"], default: "Sent" },
    items: [
      {
        description: { type: String },
        quantity: { type: Number, default: 1 },
        rate: { type: Number },
        amount: { type: Number },
      }
    ],
    notes: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Invoice", InvoiceSchema);
