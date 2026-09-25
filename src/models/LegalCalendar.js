const mongoose = require("mongoose");

const LegalCalendarSchema = new mongoose.Schema({
  calendarNumber: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  description: { type: String },
  eventDate: { type: Date },
  time: { type: String },
  location: { type: String },
  eventType: { type: String, required: true, enum: ["Hearing", "Meeting", "Deposition", "Other"], default: "Meeting" },
  attendees: { type: String },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
}, { timestamps: true });

module.exports = mongoose.model("LegalCalendar", LegalCalendarSchema);
