const mongoose = require("mongoose");

// Stores encrypted OAuth 2.0 tokens per user.
// Tokens are encrypted at rest (AES-256-CBC).
const DropboxTokenSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true, index: true, maxlength: 200 },
    accessToken: { type: String, required: true, maxlength: 5000 },
    refreshToken: { type: String, required: true, maxlength: 5000 },
    expiresAt: { type: Date, required: true },
    dropboxAccountId: { type: String, default: "", maxlength: 200 },
  },
  { timestamps: true }
);

// SECURITY: Never expose encrypted tokens in serialized API output
DropboxTokenSchema.set("toJSON", {
  transform(_doc, ret) {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    delete ret.accessToken;
    delete ret.refreshToken;
    return ret;
  },
});

module.exports = mongoose.model("DropboxToken", DropboxTokenSchema);
