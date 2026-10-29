const mongoose = require("mongoose");

const MilestoneSchema = new mongoose.Schema(
  {
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true, index: true },
    milestoneLevel: { 
      type: String, 
      enum: ["30d", "90d", "6m", "1y", "2y", "3y", "4y", "5y", "6y", "7y", "8y", "9y", "10y"], 
      required: true 
    },
    triggeredAt: { type: Date, required: true },
    hireDate: { type: Date, required: true },
    acknowledged: { type: Boolean, default: false },
    acknowledgedAt: { type: Date, default: null },
    messagesSent: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Compound indexes for efficient queries
MilestoneSchema.index({ employeeId: 1, triggeredAt: -1 });
MilestoneSchema.index({ triggeredAt: 1 });

module.exports = mongoose.model("Milestone", MilestoneSchema);
