const mongoose = require("mongoose");

const crmAutomationRuleSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    trigger: {
      type: String,
      required: true,
      enum: ["new_lead", "email_open", "site_visit", "proposal_view", "stage_change"],
      index: true,
    },
    conditions: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    actions: [
      {
        actionType: {
          type: String,
          required: true,
          enum: ["send_email", "send_sms", "create_task", "assign_salesperson", "escalate"],
        },
        params: {
          type: mongoose.Schema.Types.Mixed,
          default: {},
        },
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("CRMAutomationRule", crmAutomationRuleSchema);
