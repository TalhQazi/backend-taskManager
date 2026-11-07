const mongoose = require("mongoose");

const legalCaseSchema = new mongoose.Schema({
  caseNumber: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  clientName: { type: String, required: true },
  type: { type: String, required: true },
  status: { type: String, enum: ["Open", "In Progress", "Pending Review", "Closed"], default: "Open" },
  priority: { type: String, enum: ["Low", "Medium", "High", "Critical"], default: "Medium" },
  jurisdiction: { type: String, enum: ["State", "Federal", "Other"], default: "State", index: true },
  courtTier: { type: String, default: "District", index: true }, // State: District, Superior, Supreme; Federal: District, Circuit, Supreme
  court: { type: String },
  judge: { type: String },
  originatingCaseNumber: { type: String },
  originatingCourt: { type: String },
  judges: [{ type: String }],
  description: { type: String },
  openDate: { type: Date },
  closeDate: { type: Date },
  attachments: [
    {
      fileName: { type: String, default: "" },
      url: { type: String, default: "" },
      mimeType: { type: String, default: "" },
      size: { type: Number, default: 0 },
      uploadedAt: { type: Date, default: Date.now }
    }
  ],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
}, { timestamps: true });

module.exports = mongoose.model("LegalCase", legalCaseSchema);
