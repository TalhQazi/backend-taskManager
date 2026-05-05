const mongoose = require("mongoose");

const tenantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, index: true, trim: true },
    email: { type: String, default: "", index: true, trim: true, lowercase: true },
    phone: { type: String, default: "", trim: true },
    address: { type: String, default: "", trim: true },
    amount: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
      index: true,
    },
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

tenantSchema.pre("save", function preSave(next) {
  if (typeof this.name === "string") this.name = this.name.trim();
  if (typeof this.email === "string") this.email = this.email.trim().toLowerCase();
  if (typeof this.phone === "string") this.phone = this.phone.trim();
  if (typeof this.address === "string") this.address = this.address.trim();
  next();
});

module.exports = mongoose.model("Tenant", tenantSchema);
