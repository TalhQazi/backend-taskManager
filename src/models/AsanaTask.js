const mongoose = require("mongoose");

const AsanaTaskSchema = new mongoose.Schema(
  {
    asanaId: { type: String, required: true, unique: true, index: true },
    projectAsanaId: { type: String, default: "", index: true },
    parentAsanaId: { type: String, default: "", index: true },
    title: { type: String, default: "" },
    description: { type: String, default: "" },
    dueDate: { type: String, default: "" },
    completed: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AsanaTask", AsanaTaskSchema);
