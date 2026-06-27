const mongoose = require("mongoose");

const LegalContactSchema = new mongoose.Schema({
  contactNumber: { type: String, required: true, unique: true },\n  firstName: { type: String, required: true },\n  lastName: { type: String, required: true },\n  email: { type: String },\n  phone: { type: String },\n  company: { type: String },\n  contactType: { type: String, enum: ["Client", "Judge", "Opposing Counsel", "Expert Witness", "Other"], default: "Client" },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
}, { timestamps: true });

module.exports = mongoose.model("LegalContact", LegalContactSchema);
