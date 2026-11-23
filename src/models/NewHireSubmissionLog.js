const mongoose = require("mongoose");

const NewHireSubmissionLogSchema = new mongoose.Schema(
  {
    reportId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "NewHireReport",
      required: true,
      index: true,
    },
    attemptNumber: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ["submitted", "failed"],
      required: true,
      index: true,
    },
    method: {
      type: String,
      enum: ["sftp", "webform"],
      required: true,
    },
    payloadPreview: {
      type: String,
      default: "",
    },
    errorMessage: {
      type: String,
      default: "",
    },
    confirmationId: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("NewHireSubmissionLog", NewHireSubmissionLogSchema);
