const mongoose = require("mongoose");

/**
 * Private manager commentary about a session.
 *
 * SECURITY: never returned on any employee-scoped endpoint. Every read must go
 * through wipRepository.listManagerNotes(), which requires a manager/owner
 * actor. Do not `.populate()` this from WorkSession.
 */
const ManagerNoteSchema = new mongoose.Schema(
  {
    workSessionId: { type: mongoose.Schema.Types.ObjectId, ref: "WorkSession", required: true, index: true },
    taskId: { type: mongoose.Schema.Types.ObjectId, ref: "Task", default: null },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", default: null },
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", default: null, index: true },

    body: { type: String, required: true, trim: true },

    createdBy: { type: String, default: "" },
    createdByName: { type: String, default: "" },
    createdByRole: { type: String, default: "" },
  },
  { timestamps: true }
);

ManagerNoteSchema.index({ workSessionId: 1, createdAt: -1 });

module.exports = mongoose.model("ManagerNote", ManagerNoteSchema);
