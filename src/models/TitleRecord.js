const mongoose = require("mongoose");

const TitleRecordSchema = new mongoose.Schema(
  {
    property: { type: mongoose.Schema.Types.ObjectId, ref: "Property", required: true },
    parcelNumber: { type: String, required: true },
    ownerName: { type: String, required: true },
    liens: [
      {
        holder: String,
        amount: Number,
        recordedDate: Date,
        description: String,
      }
    ],
    lastTaxAssessment: {
      year: Number,
      amount: Number,
      status: { type: String, enum: ["Paid", "Unpaid", "Delinquent"] }
    },
    status: { type: String, enum: ["Clear", "Encumbered", "Under Review"], default: "Clear" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("TitleRecord", TitleRecordSchema);
