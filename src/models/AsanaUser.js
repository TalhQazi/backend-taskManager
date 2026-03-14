const mongoose = require("mongoose");

const AsanaUserSchema = new mongoose.Schema(
  {
    asanaId: { type: String, required: true, unique: true, index: true },
    name: { type: String, default: "" },
    email: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AsanaUser", AsanaUserSchema);
