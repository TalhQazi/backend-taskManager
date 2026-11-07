const mongoose = require("mongoose");

const CurrencyExchangeSchema = new mongoose.Schema(
  {
    baseCurrency: { type: String, default: "USD" },
    targetCurrency: { type: String, required: true },
    rate: { type: Number, required: true },
    date: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model("CurrencyExchange", CurrencyExchangeSchema);
