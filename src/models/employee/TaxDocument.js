const mongoose = require("mongoose");

const taxDocSchema = new mongoose.Schema({
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
  year: Number,
  type: String, // W-2 / 1099
  fileUrl: String,
});


module.exports = mongoose.model(
  "TaxDocument",
  taxDocSchema,
  "tax_documents"
);