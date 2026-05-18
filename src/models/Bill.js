const mongoose = require("mongoose");

const BillSchema = new mongoose.Schema(
  {
    vendor: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", required: true },
    billNumber: { type: String, required: true },
    date: { type: Date, default: Date.now },
    dueDate: { type: Date },
    amount: { type: Number, required: true },
    status: { type: String, enum: ["Unpaid", "Partially Paid", "Paid", "Overdue"], default: "Unpaid" },
    description: { type: String },
    items: [
      {
        description: { type: String },
        amount: { type: Number },
        account: { type: mongoose.Schema.Types.ObjectId, ref: "AtlasAccount" },
      }
    ],
    attachments: [{ fileName: String, url: String }],
  },
  { timestamps: true }
);

module.exports = mongoose.model("Bill", BillSchema);
