const mongoose = require("mongoose");

const shoppingListSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company" },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: "Location" },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project" },
    assignedEmployeeId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    vendors: [{ type: mongoose.Schema.Types.ObjectId, ref: "Vendor" }],
    notes: { type: String, default: "" },
    status: { 
      type: String, 
      enum: ["open", "completed", "archived"], 
      default: "open" 
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

shoppingListSchema.index({ assignedEmployeeId: 1 });
shoppingListSchema.index({ status: 1 });
shoppingListSchema.index({ companyId: 1 });
shoppingListSchema.index({ locationId: 1 });
shoppingListSchema.index({ projectId: 1 });

module.exports = mongoose.model("ShoppingList", shoppingListSchema);
