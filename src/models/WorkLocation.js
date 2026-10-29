const mongoose = require("mongoose");
const { WORK_LOCATION_TYPE_VALUES } = require("../constants/wip");

/**
 * Hierarchical work location: company > location > building > room/bay/bin/shelf.
 *
 * Uses parentId plus a materialized `path` of ancestor ids. Ancestor and subtree
 * queries read straight off `path` — never $graphLookup on the read path.
 *   descendants of X:  { path: X }
 *   ancestors of X:    { _id: { $in: X.path } }
 */
const WorkLocationSchema = new mongoose.Schema(
  {
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: "WorkLocation", default: null },
    /** Ancestor ids, root-first. Excludes self. */
    path: { type: [mongoose.Schema.Types.ObjectId], default: [], index: true },

    name: { type: String, required: true, trim: true },
    type: { type: String, enum: WORK_LOCATION_TYPE_VALUES, required: true },

    /** Optional geofence centre. null when the site has no GPS configured. */
    geo: {
      type: { type: String, enum: ["Point"], default: undefined },
      coordinates: { type: [Number], default: undefined }, // [lng, lat]
    },
    radiusMeters: { type: Number, default: 0 },

    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

WorkLocationSchema.index({ parentId: 1 });
WorkLocationSchema.index({ geo: "2dsphere" }, { sparse: true });

/** Recompute the materialized path from the parent before saving. */
WorkLocationSchema.pre("save", async function buildPath(next) {
  if (!this.isModified("parentId")) return next();
  if (!this.parentId) {
    this.path = [];
    return next();
  }
  try {
    const parent = await this.constructor.findById(this.parentId).select("path").lean();
    this.path = parent ? [...(parent.path || []), this.parentId] : [this.parentId];
    return next();
  } catch (err) {
    return next(err);
  }
});

module.exports = mongoose.model("WorkLocation", WorkLocationSchema);
