const mongoose = require("mongoose");

const propertySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, index: true },
    street: { type: String, default: "" },
    city: { type: String, default: "" },
    state: { type: String, default: "" },
    zip: { type: String, default: "" },
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

propertySchema.pre("save", function preSave(next) {
  if (typeof this.name === "string") this.name = this.name.trim();
  if (typeof this.street === "string") this.street = this.street.trim();
  if (typeof this.city === "string") this.city = this.city.trim();
  if (typeof this.state === "string") this.state = this.state.trim();
  if (typeof this.zip === "string") this.zip = this.zip.trim();
  next();
});

module.exports = mongoose.model("Property", propertySchema);
