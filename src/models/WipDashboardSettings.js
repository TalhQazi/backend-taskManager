const mongoose = require("mongoose");
const {
  IDLE_DEFAULTS,
  DEFAULT_IDLE_EXCLUDED_STATUSES,
  WIP_STATUS_VALUES,
} = require("../constants/wip");

/**
 * Module configuration. One global document (key: "global") plus optional
 * per-department overrides. Changes take effect without a deploy — the service
 * reads settings on demand (cached for 60s).
 */
const IdleConfigSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: IDLE_DEFAULTS.enabled },
    softWarningMinutes: { type: Number, default: IDLE_DEFAULTS.softWarningMinutes, min: 1 },
    reminderMinutes: { type: Number, default: IDLE_DEFAULTS.reminderMinutes, min: 1 },
    promptMinutes: { type: Number, default: IDLE_DEFAULTS.promptMinutes, min: 1 },
    managerAlertMinutes: { type: Number, default: IDLE_DEFAULTS.managerAlertMinutes, min: 1 },
    /** Statuses during which idle prompts are suppressed entirely. */
    excludedStatuses: {
      type: [{ type: String, enum: WIP_STATUS_VALUES }],
      default: () => [...DEFAULT_IDLE_EXCLUDED_STATUSES],
    },
  },
  { _id: false }
);

const DepartmentOverrideSchema = new mongoose.Schema(
  {
    department: { type: String, required: true },
    enabled: { type: Boolean, default: true },
    idle: { type: IdleConfigSchema, default: () => ({}) },
  },
  { _id: false }
);

const WipDashboardSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: "global", unique: true },

    /** Master feature flag for the whole WIP module. */
    enabled: { type: Boolean, default: true },

    idle: { type: IdleConfigSchema, default: () => ({}) },
    departments: { type: [DepartmentOverrideSchema], default: [] },

    /** GPS is off by default and requires explicit consent to enable. */
    gpsEnabled: { type: Boolean, default: false },
    gpsRequireConsent: { type: Boolean, default: true },

    /** Heartbeat / broadcast cadence. Frontend timers tick locally regardless. */
    heartbeatSeconds: { type: Number, default: 45, min: 15, max: 300 },

    tvMode: {
      rotationSeconds: { type: Number, default: 20, min: 5 },
      rowsPerPage: { type: Number, default: 12, min: 1 },
      staleAfterSeconds: { type: Number, default: 60, min: 15 },
      departments: { type: [String], default: [] },
    },

    updatedBy: { type: String, default: "" },
  },
  { timestamps: true }
);

/** Resolve effective config for a department, falling back to global. */
WipDashboardSettingsSchema.methods.forDepartment = function forDepartment(department) {
  const override = (this.departments || []).find(
    (d) => String(d.department).toLowerCase() === String(department || "").toLowerCase()
  );
  const base = this.idle ? this.idle.toObject?.() ?? this.idle : {};
  if (!override) return { enabled: this.enabled, idle: base };
  return {
    enabled: this.enabled && override.enabled !== false,
    idle: { ...base, ...(override.idle?.toObject?.() ?? override.idle ?? {}) },
  };
};

module.exports = mongoose.model("WipDashboardSettings", WipDashboardSettingsSchema);
