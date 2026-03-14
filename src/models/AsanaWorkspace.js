const mongoose = require("mongoose");

const AsanaWorkspaceSchema = new mongoose.Schema(
  {
    asanaId: { type: String, required: true, unique: true, index: true },
    name: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AsanaWorkspace", AsanaWorkspaceSchema);
