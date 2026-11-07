const mongoose = require("mongoose");

// Stores metadata references for task attachments.
// Dropbox files: reference only (no binary). Local files: S3 URL.
const AttachmentSchema = new mongoose.Schema(
  {
    task_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Task",
      required: true,
      index: true,
    },
    file_name: { type: String, required: true, maxlength: 500 },
    file_type: { type: String, default: "", maxlength: 200 },
    file_size: { type: Number, default: 0, min: 0 },
    source: {
      type: String,
      enum: ["DROPBOX", "LOCAL"],
      default: "LOCAL",
      index: true,
    },

    // Dropbox-specific
    dropbox_file_id: { type: String, default: "", maxlength: 500 },
    dropbox_path: { type: String, default: "", maxlength: 2000 },
    temporary_link: { type: String, default: "", maxlength: 5000 }, // ~4hr expiry, refreshed on demand

    // Local/S3-specific
    url: { type: String, default: "", maxlength: 5000 },

    uploaded_by: { type: String, default: "", maxlength: 200 },
    created_at: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

AttachmentSchema.index({ task_id: 1, source: 1 });

// Normalize _id → id, strip __v
AttachmentSchema.set("toJSON", {
  transform(_doc, ret) {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model("Attachment", AttachmentSchema);
