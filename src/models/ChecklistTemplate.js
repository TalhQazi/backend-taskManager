const mongoose = require("mongoose");

const checklistTemplateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    key: { type: String, required: true, unique: true }, // e.g. 'marketing', 'saas', 'ecommerce', 'internal'
    categories: [
      {
        name: { type: String, required: true }, // e.g. 'Domain & DNS', 'Security'
        items: [
          {
            title: { type: String, required: true },
            description: { type: String, default: "" },
            requiresEvidence: { type: Boolean, default: false },
          },
        ],
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model("ChecklistTemplate", checklistTemplateSchema);
