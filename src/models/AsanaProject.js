const mongoose = require("mongoose");

const AsanaProjectSchema = new mongoose.Schema(
  {
    asanaId: { type: String, required: true, unique: true, index: true },
    workspaceAsanaId: { type: String, required: true, index: true },
    name: { type: String, default: "" },
    createdAtAsana: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AsanaProject", AsanaProjectSchema);
