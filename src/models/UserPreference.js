const mongoose = require("mongoose");

const userPreferenceSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  showFounderMessages: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// Pre-save middleware to update updatedAt
userPreferenceSchema.pre("save", function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model("UserPreference", userPreferenceSchema);
