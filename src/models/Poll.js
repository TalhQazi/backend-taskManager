const mongoose = require("mongoose");

const PollOptionSchema = new mongoose.Schema({
  optionText: { type: String, required: true },
  imageUrl: { type: String, default: "" },
  displayOrder: { type: Number, default: 0 }
});

const PollAudienceSchema = new mongoose.Schema({
  targetType: { 
    type: String, 
    enum: ["Company", "Department", "Location", "Role", "Team", "All", "UserList"], 
    required: true 
  },
  targetValue: { type: String, required: true }
});

const PollSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String, required: true },
    creatorId: { type: String, required: true },
    creatorName: { type: String, required: true },
    status: { 
      type: String, 
      enum: ["Draft", "Scheduled", "Active", "Closed", "Implemented", "Rejected"], 
      default: "Active",
      index: true
    },
    pollType: { 
      type: String, 
      enum: [
        "YesNo", 
        "MultipleChoice", 
        "RankedChoice", 
        "Rating10", 
        "StarRating", 
        "DesignComparison", 
        "ImageVoting", 
        "OpenFeedback", 
        "Hybrid",
        "BudgetApproval"
      ], 
      required: true 
    },
    startTime: { type: Date, default: Date.now },
    endTime: { type: Date, required: true },
    allowCommentAttachments: { type: Boolean, default: false },
    allowVoteEditing: { type: Boolean, default: true },
    
    options: [PollOptionSchema],
    audiences: [PollAudienceSchema],
    
    // Executive Decision Fields (Embedded)
    decisionText: { type: String, default: "" },
    decisionBy: { type: String, default: "" }, // Decided by name / role
    decisionStatus: { 
      type: String, 
      enum: ["Pending", "InProgress", "Implemented", "Cancelled"], 
      default: "Pending" 
    },
    decidedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Poll", PollSchema);
