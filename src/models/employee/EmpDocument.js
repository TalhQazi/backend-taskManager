const mongoose = require("mongoose");
const docSchema = new mongoose.Schema({
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
  docType: String,
  status: { type: String, enum: ["pending", "completed"] },
  fileUrl: String,
});



module.exports = mongoose.model(
  "Document",
  docSchema,
  "documents"
);