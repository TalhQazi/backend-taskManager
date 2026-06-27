const mongoose = require("mongoose");

const LegalCalendarSchema = new mongoose.Schema({
  calendarNumber: { type: String, required: true, unique: true },\n  title: { type: String, required: true },\n  description: { type: String },\n  eventDate: { type: Date },\n  time: { type: String },\n  location: { type: String },\n  eventType: { type: String, required: true, enum: ["Hearing", "Meeting", "Deposition", "Other"], default: "Meeting" },\n  attendees: { type: String },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
}, { timestamps: true });

module.exports = mongoose.model("LegalCalendar", LegalCalendarSchema);
