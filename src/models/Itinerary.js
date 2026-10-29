const mongoose = require("mongoose");

const ItineraryStopSchema = new mongoose.Schema({
  title: { type: String, required: true },
  address: { type: String, default: "" },
  latitude: { type: Number, required: true },
  longitude: { type: Number, required: true },
  estimatedDurationMinutes: { type: Number, default: 30 },
  sequenceOrder: { type: Number, default: 0 },
  travelTimeToNext: { type: Number, default: 0 }, // in minutes
  taskId: { type: mongoose.Schema.Types.ObjectId, ref: "Task", required: false },
  locationId: { type: mongoose.Schema.Types.ObjectId, ref: "Location", required: false },
  completed: { type: Boolean, default: false },
  completedAt: { type: Date, default: null }
});

const ItinerarySchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true }, // Store Employee's _id (as a string to be flexible and align with project conventions)
    date: { type: String, required: true, index: true }, // Date string in format YYYY-MM-DD (safe against time zone conversions)
    startTime: { type: String, default: "08:00" }, // e.g. "08:30"
    optimized: { type: Boolean, default: false },
    stops: [ItineraryStopSchema]
    ,
    lastLocation: {
      latitude: { type: Number, required: false },
      longitude: { type: Number, required: false },
      updatedAt: { type: Date, required: false }
    }
  },
  { timestamps: true }
);

// Unique compound index so that an employee only has one itinerary per day
ItinerarySchema.index({ userId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("Itinerary", ItinerarySchema);
