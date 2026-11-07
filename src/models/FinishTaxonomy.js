const mongoose = require("mongoose");

const FinishTaxonomySchema = new mongoose.Schema(
  {
    organizationId: { type: String, default: "global", index: true },
    category: {
      type: String,
      enum: ["surface", "sheen", "material"],
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    isCustom: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0 },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

FinishTaxonomySchema.index({ organizationId: 1, category: 1, code: 1 }, { unique: true });

const DEFAULT_SURFACES = [
  "Walls",
  "Ceiling",
  "Doors",
  "Door Trim",
  "Window Trim",
  "Baseboards",
  "Crown Molding",
  "Cabinets",
  "Shelving",
  "Interior Metal",
  "Exterior Siding",
  "Exterior Trim",
  "Exterior Doors",
  "Foundation",
  "Deck/Porch",
  "Floor",
  "Concrete",
  "Railings",
  "Service Bay",
  "Mechanical/Utility",
  "Other",
];

const DEFAULT_SHEENS = [
  "Flat",
  "Matte",
  "Eggshell",
  "Satin",
  "Pearl",
  "Semi-Gloss",
  "Gloss",
  "High-Gloss",
  "Primer",
  "Stain",
  "Clear Coat",
  "Specialty / Custom",
];

const DEFAULT_MATERIALS = [
  "Paint & Coatings",
  "Stain & Varnish",
  "Flooring",
  "Tile & Stone",
  "Grout & Caulk",
  "Siding & Cladding",
  "Roofing",
  "Cabinetry & Millwork",
  "Trim & Molding",
  "Wallpaper & Wallcoverings",
  "Countertops",
];

FinishTaxonomySchema.statics.getDefaultSurfaces = () => DEFAULT_SURFACES;
FinishTaxonomySchema.statics.getDefaultSheens = () => DEFAULT_SHEENS;
FinishTaxonomySchema.statics.getDefaultMaterials = () => DEFAULT_MATERIALS;

module.exports = mongoose.model("FinishTaxonomy", FinishTaxonomySchema);

