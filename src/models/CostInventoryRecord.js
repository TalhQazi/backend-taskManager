const mongoose = require("mongoose");

// Connects a purchased line item to a physical quantity and exact storage
// location. Multiple records per item support splitting quantity across
// warehouses/shops (e.g. 5 lbs in Bin A-12, 3 lbs in Locked Cabinet 2).
const CostInventoryRecordSchema = new mongoose.Schema(
  {
    lineItemId: { type: mongoose.Schema.Types.ObjectId, ref: "CostLineItem", required: true, index: true },
    costSheetId: { type: mongoose.Schema.Types.ObjectId, ref: "CostSheet", required: true, index: true },
    projectId: { type: String, required: true, index: true },

    locationName: { type: String, required: true, trim: true },
    address: { type: String, default: "" },
    building: { type: String, default: "" },
    room: { type: String, default: "" },
    aisle: { type: String, default: "" },
    shelf: { type: String, default: "" },
    bin: { type: String, default: "" },

    qtyStored: { type: Number, default: 0, min: 0 },
    unit: { type: String, default: "" },
    notes: { type: String, default: "" },

    // Auto-generated lookup code; searching it opens the item record.
    qrCode: { type: String, unique: true, index: true },
    photoUrl: { type: String, default: "" },

    storedByUserId: { type: String, default: "" },
    storedByUsername: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("CostInventoryRecord", CostInventoryRecordSchema);
