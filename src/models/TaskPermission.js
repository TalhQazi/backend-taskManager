const mongoose = require("mongoose");

const TaskPermissionSchema = new mongoose.Schema(
  {
    taskId: { type: mongoose.Schema.Types.ObjectId, ref: "Task", required: true, unique: true, index: true },
    canReassign: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("TaskPermission", TaskPermissionSchema);
