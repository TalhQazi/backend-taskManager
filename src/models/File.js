// models/File.js
const mongoose = require("mongoose");

const FileSchema = new mongoose.Schema({
  expenseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "ExpenseItem",
  },
  fileUrl: String,
  fileType: String,
});

module.exports = mongoose.model("File", FileSchema);