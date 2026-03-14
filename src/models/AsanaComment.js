const mongoose = require("mongoose");

const AsanaCommentSchema = new mongoose.Schema(
  {
    asanaId: { type: String, required: true, unique: true, index: true },
    taskAsanaId: { type: String, required: true, index: true },
    authorAsanaId: { type: String, default: "", index: true },
    message: { type: String, default: "" },
    createdAtAsana: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AsanaComment", AsanaCommentSchema);
