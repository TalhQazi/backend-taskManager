const express = require("express");
const { requireAuth, requireRole } = require("../middleware/auth");
const Employee = require("../models/Employee");
const EmployeeBankInfo = require("../models/EmployeeBankInfo");
const EmployeeChangeRequest = require("../models/EmployeeChangeRequest");
const EmployeeTimelineEvent = require("../models/EmployeeTimelineEvent");
const ActivityLog = require("../models/ActivityLog");
const { encryptField, maskSSN } = require("../utils/encryption");
const { createNotification } = require("../utils/notifications");

const router = express.Router();

// GET /api/hr/change-requests - List change requests (with status filter)
router.get("/", requireAuth, requireRole(["super-admin", "admin", "manager"]), async (req, res, next) => {
  try {
    const status = req.query.status || "pending";
    const query = status === "all" ? {} : { status };

    const requests = await EmployeeChangeRequest.find(query)
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      items: requests.map((r) => ({
        id: String(r._id),
        employeeId: String(r.employeeId),
        employeeName: r.employeeName,
        requestType: r.requestType,
        currentData: r.currentData,
        proposedData: r.proposedData,
        reason: r.reason,
        status: r.status,
        reviewedBy: r.reviewedBy ? String(r.reviewedBy) : null,
        reviewedByName: r.reviewedByName || "",
        reviewedAt: r.reviewedAt || null,
        rejectionReason: r.rejectionReason || "",
        createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/hr/change-requests/:id - Review (Approve / Reject) a change request
router.patch("/:id", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const { action, rejectionReason } = req.body; // action: "approve" | "reject"
    if (!["approve", "reject"].includes(action)) {
      return res.status(400).json({ error: { message: "Invalid action. Must be 'approve' or 'reject'" } });
    }

    const changeRequest = await EmployeeChangeRequest.findById(req.params.id);
    if (!changeRequest) {
      return res.status(404).json({ error: { message: "Change request not found" } });
    }

    if (changeRequest.status !== "pending") {
      return res.status(400).json({ error: { message: `Request is already ${changeRequest.status}` } });
    }

    const reviewerId = req.user.sub || req.user.id;
    const reviewerName = req.user.name || req.user.username || "Admin";

    if (action === "approve") {
      const employee = await Employee.findById(changeRequest.employeeId);
      if (!employee) {
        return res.status(404).json({ error: { message: "Associated employee not found" } });
      }

      // Apply changes based on requestType
      const proposed = changeRequest.proposedData || {};

      if (changeRequest.requestType === "personal_info") {
        if (proposed.legalName !== undefined) employee.legalName = proposed.legalName;
        if (proposed.preferredName !== undefined) employee.preferredName = proposed.preferredName;
        if (proposed.personalEmail !== undefined) employee.personalEmail = proposed.personalEmail;
        if (proposed.personalPhone !== undefined) employee.personalPhone = proposed.personalPhone;
        await employee.save();
      } else if (changeRequest.requestType === "address") {
        employee.address = {
          street: proposed.street || employee.address?.street || "",
          city: proposed.city || employee.address?.city || "",
          state: proposed.state || employee.address?.state || "",
          zip: proposed.zip || employee.address?.zip || "",
          country: proposed.country || employee.address?.country || "US",
        };
        await employee.save();
      } else if (changeRequest.requestType === "emergency_contacts") {
        if (Array.isArray(proposed.emergencyContacts)) {
          employee.emergencyContacts = proposed.emergencyContacts;
          await employee.save();
        }
      } else if (changeRequest.requestType === "banking_info") {
        const accountNumber = String(proposed.accountNumber || "").trim();
        const routingNumber = String(proposed.routingNumber || "").trim();

        const accountNumberEncrypted = accountNumber ? encryptField(accountNumber) : "";
        const routingNumberEncrypted = routingNumber ? encryptField(routingNumber) : "";
        const accountNumberMasked = accountNumber ? `•••• ${accountNumber.slice(-4)}` : "";
        const routingNumberMasked = routingNumber ? `•••• ${routingNumber.slice(-4)}` : "";

        await EmployeeBankInfo.findOneAndUpdate(
          { employeeId: employee._id },
          {
            bankName: proposed.bankName || "",
            accountHolderName: proposed.accountHolderName || employee.name,
            accountType: proposed.accountType || "checking",
            ...(accountNumber && { accountNumberEncrypted, accountNumberMasked }),
            ...(routingNumber && { routingNumberEncrypted, routingNumberMasked }),
            isVerified: true,
            updatedBy: reviewerName,
          },
          { upsert: true, new: true }
        );
      }

      changeRequest.status = "approved";
      changeRequest.reviewedBy = reviewerId;
      changeRequest.reviewedByName = reviewerName;
      changeRequest.reviewedAt = new Date();
      await changeRequest.save();

      // Log business timeline event
      await EmployeeTimelineEvent.create({
        employeeId: employee._id,
        eventType: "change_request_approved",
        title: `Self-Service ${changeRequest.requestType.replace(/_/g, " ")} Approved`,
        description: `Change request approved by ${reviewerName}`,
        eventDate: new Date(),
        actorId: reviewerId,
        actorName: reviewerName,
        actorRole: req.user.role,
        metadata: { requestType: changeRequest.requestType, proposed },
      });

      // Operational audit log
      await ActivityLog.create({
        actorUserId: String(reviewerId),
        actorUsername: reviewerName,
        actorRole: req.user.role,
        action: "HR_CHANGE_REQUEST_APPROVE",
        resourceType: "employee",
        resourceId: String(employee._id),
        resourceName: employee.name,
        description: `Approved ${changeRequest.requestType} change request for ${employee.name}`,
      }).catch(() => {});

      // Notify employee
      await createNotification({
        actor: reviewerName,
        actorRole: req.user.role,
        action: "approved your change request",
        resourceType: "employee",
        resourceName: changeRequest.requestType,
        details: `Your requested update for ${changeRequest.requestType.replace(/_/g, " ")} has been approved.`,
        recipient: employee.email || employee.name,
      }).catch(() => {});

      return res.json({ success: true, item: changeRequest });
    } else {
      // Rejection
      changeRequest.status = "rejected";
      changeRequest.reviewedBy = reviewerId;
      changeRequest.reviewedByName = reviewerName;
      changeRequest.reviewedAt = new Date();
      changeRequest.rejectionReason = rejectionReason || "Declined by administrator";
      await changeRequest.save();

      // Operational audit log
      await ActivityLog.create({
        actorUserId: String(reviewerId),
        actorUsername: reviewerName,
        actorRole: req.user.role,
        action: "HR_CHANGE_REQUEST_REJECT",
        resourceType: "employee",
        resourceId: String(changeRequest.employeeId),
        resourceName: changeRequest.employeeName,
        description: `Rejected ${changeRequest.requestType} change request for ${changeRequest.employeeName}: ${changeRequest.rejectionReason}`,
      }).catch(() => {});

      return res.json({ success: true, item: changeRequest });
    }
  } catch (err) {
    next(err);
  }
});

module.exports = router;
