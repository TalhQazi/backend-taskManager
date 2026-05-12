const mongoose = require("mongoose");

const travelCalendarSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
  },
  description: {
    type: String,
    trim: true,
  },
  startDate: {
    type: Date,
    required: true,
  },
  endDate: {
    type: Date,
    required: true,
  },
  destination: {
    type: String,
    required: true,
    trim: true,
  },
  purpose: {
    type: String,
    enum: ["business", "personal", "conference", "meeting", "training", "other"],
    default: "business",
  },
  status: {
    type: String,
    enum: ["planned", "approved", "in-progress", "completed", "cancelled"],
    default: "planned",
  },
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
  budget: {
    estimated: {
      type: Number,
      default: 0,
    },
    actual: {
      type: Number,
      default: 0,
    },
    currency: {
      type: String,
      default: "USD",
    },
  },
  attachments: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "Attachment",
  }],
  notes: {
    type: String,
    trim: true,
  },
  visibility: {
    type: String,
    enum: ["private", "team", "department", "company"],
    default: "team",
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
}, {
  timestamps: true,
});

// Indexes for better performance
travelCalendarSchema.index({ employee: 1, startDate: -1 });
travelCalendarSchema.index({ startDate: 1, endDate: 1 });
travelCalendarSchema.index({ status: 1 });
travelCalendarSchema.index({ visibility: 1 });

// Validation: end date must be after start date
travelCalendarSchema.pre("save", function(next) {
  if (this.endDate <= this.startDate) {
    next(new Error("End date must be after start date"));
  } else {
    next();
  }
});

module.exports = mongoose.model("TravelCalendar", travelCalendarSchema);
