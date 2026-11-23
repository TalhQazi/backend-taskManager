const mongoose = require("mongoose");

const FinishRecordPhotoSchema = new mongoose.Schema(
  {
    finishRecordId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FinishRecord",
      required: true,
      index: true,
    },
    photoType: {
      type: String,
      enum: ["paint_can", "color_code_label", "finished_surface", "receipt", "other"],
      default: "paint_can",
      index: true,
    },
    fileId: { type: String, default: "" },
    fileUrl: { type: String, required: true },
    thumbnailUrl: { type: String, default: "" },
    caption: { type: String, default: "" },
    sortOrder: { type: Number, default: 0 },
    uploadedBy: { type: String, default: "" },
    uploadedByName: { type: String, default: "" },
    uploadedAt: { type: Date, default: Date.now },
    metadata: {
      fileSize: { type: Number, default: 0 },
      mimeType: { type: String, default: "" },
      originalName: { type: String, default: "" },
      width: { type: Number },
      height: { type: Number },
    },
  },
  { timestamps: true }
);

FinishRecordPhotoSchema.index({ finishRecordId: 1, sortOrder: 1 });

module.exports = mongoose.model("FinishRecordPhoto", FinishRecordPhotoSchema);

