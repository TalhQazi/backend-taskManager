const mongoose = require("mongoose");

const emailAccountSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    password: {
      type: String,
      default: "",
    },
    provider: {
      type: String,
      default: "Other", // e.g., Gmail, Outlook, Private
    },
    brand: {
      type: String,
      default: "",
    },
    status: {
      type: String,
      enum: ["Active", "Inactive", "Suspended"],
      default: "Active",
    },
    notes: {
      type: String,
      default: "",
    },
    createdBy: {
      type: String,
      default: "System",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("EmailAccount", emailAccountSchema);
