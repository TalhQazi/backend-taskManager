const mongoose = require("mongoose");

const shoppingListItemSchema = new mongoose.Schema(
  {
    shoppingListId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "ShoppingList", 
      required: true 
    },
    name: { type: String, required: true, trim: true },
    quantity: { type: String, default: "1" },
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor" },
    category: { type: String, default: "General" },
    priority: { 
      type: String, 
      enum: ["low", "medium", "high"], 
      default: "medium" 
    },
    notes: { type: String, default: "" },
    isPurchased: { type: Boolean, default: false },
    purchasedAt: { type: Date },
    aisle: { type: String, default: "" },
  },
  { timestamps: true }
);

shoppingListItemSchema.index({ shoppingListId: 1 });
shoppingListItemSchema.index({ isPurchased: 1 });
shoppingListItemSchema.index({ vendorId: 1 });

module.exports = mongoose.model("ShoppingListItem", shoppingListItemSchema);
