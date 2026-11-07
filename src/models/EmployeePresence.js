const mongoose = require("mongoose");
const { WIP_DEVICE_TYPE, WIP_DEVICE_TYPE_VALUES } = require("../constants/wip");

/**
 * Live presence per employee. One document per employee, upserted.
 *
 * `clockedIn` mirrors the payroll system (TimeEntry) and is deliberately
 * separate from having an active work session: a person can be clocked in with
 * no active task, and must never be assumed to be working because a timer runs.
 */
const EmployeePresenceSchema = new mongoose.Schema(
  {
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
    employeeName: { type: String, default: "" },
    department: { type: String, default: "", index: true },

    clockedIn: { type: Boolean, default: false, index: true },
    online: { type: Boolean, default: false, index: true },

    deviceType: { type: String, enum: WIP_DEVICE_TYPE_VALUES, default: WIP_DEVICE_TYPE.UNKNOWN },
    lastActivityAt: { type: Date, default: Date.now, index: true },
    lastKnownLocationId: { type: mongoose.Schema.Types.ObjectId, ref: "WorkLocation", default: null },

    /** Highest idle tier already signalled, so we don't re-notify on every tick. */
    idleTierNotified: { type: Number, default: 0 },
  },
  { timestamps: true }
);

EmployeePresenceSchema.index({ employeeId: 1 }, { unique: true });

module.exports = mongoose.model("EmployeePresence", EmployeePresenceSchema);
