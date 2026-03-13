const mongoose = require("mongoose");

const AssetSequenceSchema = new mongoose.Schema({
  sequence: { type: Number, default: 0 },
});

module.exports = mongoose.model("AssetSequence", AssetSequenceSchema);
