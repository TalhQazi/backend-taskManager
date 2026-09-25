const mongoose = require("mongoose");

const SyncSequenceSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

SyncSequenceSchema.statics.getNextLsn = async function (session = null) {
  const options = { new: true, upsert: true };
  if (session) {
    options.session = session;
  }
  const counter = await this.findByIdAndUpdate(
    "global_sync_lsn",
    { $inc: { seq: 1 } },
    options
  );
  return counter.seq;
};

module.exports = mongoose.model("SyncSequence", SyncSequenceSchema);
