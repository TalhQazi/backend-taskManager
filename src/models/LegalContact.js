const mongoose = require("mongoose");

const LegalContactSchema = new mongoose.Schema({
  contactNumber: { type: String, required: true, unique: true },
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  email: { type: String },
  phone: { type: String },
  company: { type: String },
  contactType: { type: String, enum: ["Client", "Judge", "Opposing Counsel", "Expert Witness", "Other"], default: "Client" },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
}, { timestamps: true });

module.exports = mongoose.model("LegalContact", LegalContactSchema);
