const mongoose = require("mongoose");

const schema = new mongoose.Schema({
  itemId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "ExpenseItem",
    required: true,
  },
  fileUrl: String,
  uploadedAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("ExpenseAttachment", schema);