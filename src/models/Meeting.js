const mongoose = require("mongoose");

const MeetingSchema = new mongoose.Schema(
  {
    roomCode: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      default: "Quick Meeting",
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    meetingType: {
      type: String,
      enum: ["instant", "scheduled"],
      default: "instant",
    },
    scheduledStartTime: {
      type: Date,
      default: null,
    },
    timezone: {
      type: String,
      default: "UTC",
    },
    durationMinutes: {
      type: Number,
      default: 30,
    },
    hostId: {
      type: String,
      required: true,
      index: true,
    },
    hostName: {
      type: String,
      default: "Host",
    },
    hostEmail: {
      type: String,
      default: "",
    },
    hostRole: {
      type: String,
      default: "admin",
    },
    invitedParticipants: {
      type: [
        {
          userId: { type: String, default: "" },
          name: { type: String, default: "" },
          email: { type: String, default: "" },
          role: { type: String, default: "employee" },
        },
      ],
      default: [],
    },
    joinedParticipants: {
      type: [
        {
          userId: { type: String, default: "" },
          name: { type: String, default: "" },
          email: { type: String, default: "" },
          role: { type: String, default: "employee" },
          joinedAt: { type: Date, default: Date.now },
          leftAt: { type: Date, default: null },
        },
      ],
      default: [],
    },
    taskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Task",
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: ["scheduled", "active", "ended"],
      default: "active",
      index: true,
    },
    passcode: {
      type: String,
      default: "",
    },
    startedAt: {
      type: Date,
      default: Date.now,
    },
    endedAt: {
      type: Date,
      default: null,
    },
    recordingUrl: {
      type: String,
      default: "",
    },
    recordings: {
      type: [
        {
          url: { type: String, required: true },
          fileName: { type: String, default: "" },
          durationSeconds: { type: Number, default: 0 },
          sizeBytes: { type: Number, default: 0 },
          recordedBy: { type: String, default: "" },
          recordedByName: { type: String, default: "" },
          createdAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

MeetingSchema.index({ scheduledStartTime: 1 });
MeetingSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("Meeting", MeetingSchema);
