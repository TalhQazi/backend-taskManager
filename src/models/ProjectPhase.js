// models/ProjectPhase.js
const mongoose = require("mongoose");

const ProjectPhaseSchema = new mongoose.Schema({
  projectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Project",
    required: true,
  },
  name: String, // concept, design, etc
  order: Number,

  estimatedTotal: { type: Number, default: 0 },
  actualTotal: { type: Number, default: 0 },
});

module.exports = mongoose.model("ProjectPhase", ProjectPhaseSchema);