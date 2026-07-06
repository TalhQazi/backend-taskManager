const express = require("express");
const Onboarding = require("../models/Onboarding");
const Employee = require("../models/Employee");
const NewHireReport = require("../models/NewHireReport");
const ClearHireProfile = require("../models/ClearHireProfile");
const Company = require("../models/Company");
const { requireAuth, requireRole } = require("../middleware/auth");
const { createNotification } = require("../utils/notifications");

const router = express.Router();

// Helper function to get employee context
async function requireEmployeeSelf(req, res) {
  try {
    const userId = String(req.user?.sub || "").trim();
    const username = String(req.user?.username || "").trim();
    const name = String(req.user?.name || "").trim();

    let employee = await Employee.findById(userId);

    if (!employee && (username || name)) {
      const candidates = [username, name].filter(Boolean);
      const regexes = candidates.map((c) => new RegExp(`^${String(c).replace(/[.*+?^${}()|[\]\\]/g, "\$&")}$`, "i"));
      employee = await Employee.findOne({
        $or: [{ email: { $in: regexes } }, { name: { $in: regexes } }],
      });
    }

    if (!employee) {
      res.status(404).json({ error: { message: "Employee not found" } });
      return null;
    }
    const user = {
      _id: employee._id,
      email: employee.email || "",
      name: employee.name || "",
      username: username || employee.email || "",
      role: req.user?.role || "employee",
    };
    return { user, employee };
  } catch (err) {
    res.status(500).json({ error: { message: "Server error" } });
    return null;
  }
}

// Helper function to calculate onboarding progress
function calculateProgress(onboarding, clearHireStatus = "PENDING") {
  let completed = 0;

  // Basic Information
  if (onboarding.basicInfo?.completed) completed++;

  // Identity Verification (both primary and secondary must be submitted)
  if (onboarding.identityVerification?.primaryId?.status === "submitted" ||
      onboarding.identityVerification?.primaryId?.status === "verified") {
    if (onboarding.identityVerification?.secondaryId?.status === "submitted" ||
        onboarding.identityVerification?.secondaryId?.status === "verified") {
      completed++;
    }
  }

  // W-4 Form
  const hasW4 = onboarding.w4Form?.status === "submitted" || onboarding.w4Form?.status === "verified";
  if (hasW4) {
    completed++;
  }

  // Employee Handbook
  if (onboarding.employeeHandbook?.status === "submitted" || onboarding.employeeHandbook?.status === "verified") {
    completed++;
  }

  // Digital Signature
  if (onboarding.digitalSignature?.status === "submitted" || onboarding.digitalSignature?.status === "verified") {
    completed++;
  }

  // Work Information
  if (onboarding.workInfo?.completed) {
    completed++;
  }

  // ClearHire Background Check (requires GREEN status)
  if (clearHireStatus === "GREEN") {
    completed++;
  }

  const total = hasW4 ? 7 : 6;
  return Math.round((completed / total) * 100);
}

// Asynchronous helper to resolve user's ClearHire status and get progress
async function getProgress(onboarding) {
  if (!onboarding) return 0;
  try {
    const clearHire = await ClearHireProfile.findOne({ userId: onboarding.userId }).select("status").lean();
    return calculateProgress(onboarding, clearHire ? clearHire.status : "PENDING");
  } catch (err) {
    console.error("[onboarding getProgress] ClearHire status lookup error:", err.message);
    return calculateProgress(onboarding, "PENDING");
  }
}

// GET /api/onboarding/me - Get employee's onboarding status
router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeSelf(req, res);
    if (!ctx) return;
    const { user, employee } = ctx;

    let onboarding = await Onboarding.findOne({ userId: user._id });

    if (!onboarding) {
      // Create new onboarding record
      onboarding = await Onboarding.create({
        userId: user._id,
        employeeId: employee._id,
        employeeName: employee.name || user.name,
      });
    }

    return res.json({
      item: {
        id: String(onboarding._id),
        userId: String(onboarding.userId),
        employeeId: String(onboarding.employeeId),
        employeeName: onboarding.employeeName,
        basicInfo: onboarding.basicInfo,
        identityVerification: onboarding.identityVerification,
        w4Form: onboarding.w4Form,
        employeeHandbook: onboarding.employeeHandbook,
        digitalSignature: onboarding.digitalSignature,
        workInfo: onboarding.workInfo,
        overallStatus: onboarding.overallStatus,
        progress: await getProgress(onboarding),
        adminReview: onboarding.adminReview,
        createdAt: onboarding.createdAt,
        updatedAt: onboarding.updatedAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/onboarding/me - Create or update full onboarding data
router.post("/me", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeSelf(req, res);
    if (!ctx) return;
    const { user, employee } = ctx;

    const { personalInfo, identityVerification, taxInfo, bankInfo, documents } = req.body;

    let onboarding = await Onboarding.findOne({ userId: user._id });
    
    if (!onboarding) {
      onboarding = new Onboarding({
        userId: user._id,
        employeeId: employee._id,
        employeeName: employee.name || user.name,
      });
    }

    // Update basic info if provided
    if (personalInfo) {
      onboarding.basicInfo = {
        completed: true,
        email: user.email,
        phone: personalInfo.phone || "",
        location: personalInfo.address || "",
      };
    }

    // Update identity verification if provided
    if (identityVerification) {
      if (!onboarding.identityVerification) {
        onboarding.identityVerification = {
          primaryId: { idType: "", frontImage: "", backImage: "", status: "not_started" },
          secondaryId: { idType: "", image: "", status: "not_started" },
        };
      }
      if (identityVerification.idType) {
        onboarding.identityVerification.primaryId.idType = identityVerification.idType;
      }
      if (identityVerification.idNumber) {
        onboarding.identityVerification.primaryId.idNumber = identityVerification.idNumber;
      }
      if (identityVerification.idFrontUrl) {
        onboarding.identityVerification.primaryId.frontImage = identityVerification.idFrontUrl;
        onboarding.identityVerification.primaryId.status = "submitted";
      }
      if (identityVerification.idBackUrl) {
        onboarding.identityVerification.primaryId.backImage = identityVerification.idBackUrl;
      }
      if (identityVerification.secondaryIdType) {
        onboarding.identityVerification.secondaryId.idType = identityVerification.secondaryIdType;
      }
      if (identityVerification.secondaryIdUrl) {
        onboarding.identityVerification.secondaryId.image = identityVerification.secondaryIdUrl;
        onboarding.identityVerification.secondaryId.status = "submitted";
      }
    }

    // Update W-4 form if provided
    if (documents && documents.w4FormUrl) {
      if (!onboarding.w4Form) {
        onboarding.w4Form = { status: "not_started", documentUrl: "" };
      }
      onboarding.w4Form.documentUrl = documents.w4FormUrl;
      onboarding.w4Form.status = "submitted";
    }

    // Update employee handbook if provided
    if (documents && documents.handbookSignatureUrl) {
      if (!onboarding.employeeHandbook) {
        onboarding.employeeHandbook = { status: "not_started", documentUrl: "" };
      }
      onboarding.employeeHandbook.documentUrl = documents.handbookSignatureUrl;
      onboarding.employeeHandbook.status = "submitted";
    }

    // Update digital signature status if all mandatory docs are submitted
    if (onboarding.basicInfo.completed &&
        onboarding.identityVerification.primaryId.status === "submitted" &&
        onboarding.identityVerification.secondaryId.status === "submitted" &&
        onboarding.employeeHandbook.status === "submitted") {
      if (!onboarding.digitalSignature) {
        onboarding.digitalSignature = { status: "not_started", signatureData: "" };
      }
      if (onboarding.digitalSignature.status === "not_started" || onboarding.digitalSignature.status === "missing") {
        onboarding.digitalSignature.status = "submitted";
      }
    }

    // Calculate overall status (W-4 is optional)
    const allSubmitted = onboarding.basicInfo.completed &&
                          onboarding.identityVerification.primaryId.status === "submitted" &&
                          onboarding.identityVerification.secondaryId.status === "submitted" &&
                          onboarding.employeeHandbook.status === "submitted" &&
                          onboarding.digitalSignature.status === "submitted";

    if (allSubmitted) {
      onboarding.overallStatus = "submitted";
    } else {
      onboarding.overallStatus = "in_progress";
    }

    await onboarding.save();

    // Notify admin if submitted
    if (onboarding.overallStatus === "submitted") {
      await createNotification({
        actor: employee.name,
        actorRole: user.role,
        action: "submitted",
        resourceType: "onboarding",
        resourceName: employee.name,
        details: "onboarding for review",
        link: "/admin/onboarding",
      });
    }

    return res.json({
      item: {
        id: String(onboarding._id),
        overallStatus: onboarding.overallStatus,
        progress: await getProgress(onboarding),
      },
      message: onboarding.overallStatus === "submitted" 
        ? "Onboarding submitted for review" 
        : "Onboarding saved successfully",
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/onboarding/me/basic-info - Update basic information
router.put("/me/basic-info", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeSelf(req, res);
    if (!ctx) return;
    const { user, employee } = ctx;

    const { phone, location } = req.body;

    if (!phone) {
      return res.status(400).json({ error: { message: "Phone number is required" } });
    }

    let onboarding = await Onboarding.findOne({ userId: user._id });
    if (!onboarding) {
      onboarding = new Onboarding({
        userId: user._id,
        employeeId: employee._id,
        employeeName: employee.name,
      });
    }

    onboarding.basicInfo = {
      completed: true,
      email: user.email,
      phone: phone,
      location: location || "",
    };

    await onboarding.save();

    return res.json({
      item: {
        id: String(onboarding._id),
        basicInfo: onboarding.basicInfo,
        overallStatus: onboarding.overallStatus,
        progress: await getProgress(onboarding),
      },
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/onboarding/me/identity - Update identity verification
router.put("/me/identity", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeSelf(req, res);
    if (!ctx) return;
    const { user, employee } = ctx;

    const { primaryId, secondaryId } = req.body;

    let onboarding = await Onboarding.findOne({ userId: user._id });
    if (!onboarding) {
      onboarding = new Onboarding({
        userId: user._id,
        employeeId: employee._id,
        employeeName: employee.name,
      });
    }

    // Initialize identityVerification if it doesn't exist
    if (!onboarding.identityVerification) {
      onboarding.identityVerification = {
        primaryId: { idType: "", frontImage: "", backImage: "", status: "not_started" },
        secondaryId: { idType: "", image: "", status: "not_started" },
      };
    }

    // Update primary ID if provided
    if (primaryId) {
      if (!primaryId.idType) {
        return res.status(400).json({ error: { message: "Primary ID type is required" } });
      }
      if (!primaryId.frontImage) {
        return res.status(400).json({ error: { message: "Primary ID front image is required" } });
      }
      if (!primaryId.backImage) {
        return res.status(400).json({ error: { message: "Primary ID back image is required" } });
      }

      onboarding.identityVerification.primaryId = {
        idType: primaryId.idType,
        frontImage: primaryId.frontImage,
        backImage: primaryId.backImage,
        status: "submitted",
      };
    }

    // Update secondary ID if provided
    if (secondaryId) {
      if (!secondaryId.idType) {
        return res.status(400).json({ error: { message: "Secondary ID type is required" } });
      }
      if (!secondaryId.image) {
        return res.status(400).json({ error: { message: "Secondary ID image is required" } });
      }

      onboarding.identityVerification.secondaryId = {
        idType: secondaryId.idType,
        image: secondaryId.image,
        status: "submitted",
      };
    }

    await onboarding.save();

    return res.json({
      item: {
        id: String(onboarding._id),
        identityVerification: onboarding.identityVerification,
        overallStatus: onboarding.overallStatus,
        progress: await getProgress(onboarding),
      },
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/onboarding/me/w4 - Update W-4 form
router.put("/me/w4", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeSelf(req, res);
    if (!ctx) return;
    const { user, employee } = ctx;

    const { file } = req.body;

    if (!file) {
      return res.status(400).json({ error: { message: "W-4 form file is required" } });
    }

    let onboarding = await Onboarding.findOne({ userId: user._id });
    if (!onboarding) {
      onboarding = new Onboarding({
        userId: user._id,
        employeeId: employee._id,
        employeeName: employee.name,
      });
    }

    onboarding.w4Form = {
      file: file,
      status: "submitted",
    };

    await onboarding.save();

    return res.json({
      item: {
        id: String(onboarding._id),
        w4Form: onboarding.w4Form,
        overallStatus: onboarding.overallStatus,
        progress: await getProgress(onboarding),
      },
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/onboarding/me/handbook - Update employee handbook acknowledgment
router.put("/me/handbook", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeSelf(req, res);
    if (!ctx) return;
    const { user, employee } = ctx;

    const { signature } = req.body;

    if (!signature) {
      return res.status(400).json({ error: { message: "Signature is required" } });
    }

    let onboarding = await Onboarding.findOne({ userId: user._id });
    if (!onboarding) {
      onboarding = new Onboarding({
        userId: user._id,
        employeeId: employee._id,
        employeeName: employee.name,
      });
    }

    onboarding.employeeHandbook = {
      acknowledged: true,
      signature: signature,
      signedAt: new Date(),
      status: "submitted",
    };

    await onboarding.save();

    return res.json({
      item: {
        id: String(onboarding._id),
        employeeHandbook: onboarding.employeeHandbook,
        overallStatus: onboarding.overallStatus,
        progress: await getProgress(onboarding),
      },
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/onboarding/me/signature - Update digital signature
router.put("/me/signature", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeSelf(req, res);
    if (!ctx) return;
    const { user, employee } = ctx;

    const { signature } = req.body;

    if (!signature) {
      return res.status(400).json({ error: { message: "Signature is required" } });
    }

    let onboarding = await Onboarding.findOne({ userId: user._id });
    if (!onboarding) {
      onboarding = new Onboarding({
        userId: user._id,
        employeeId: employee._id,
        employeeName: employee.name,
      });
    }

    onboarding.digitalSignature = {
      signature: signature,
      status: "submitted",
    };

    await onboarding.save();

    return res.json({
      item: {
        id: String(onboarding._id),
        digitalSignature: onboarding.digitalSignature,
        overallStatus: onboarding.overallStatus,
        progress: await getProgress(onboarding),
      },
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/onboarding/me/work-info - Update work information
router.put("/me/work-info", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeSelf(req, res);
    if (!ctx) return;
    const { user, employee } = ctx;

    const { department, jobTitle, manager, joinDate } = req.body; // ← joinDate add

    if (!department || !jobTitle) {
      return res.status(400).json({ error: { message: "Department and Job Title are required" } });
    }

    let onboarding = await Onboarding.findOne({ userId: user._id });
    if (!onboarding) {
      onboarding = new Onboarding({
        userId: user._id,
        employeeId: employee._id,
        employeeName: employee.name,
      });
    }

    onboarding.workInfo = {
      completed: true,
      department,
      jobTitle,
      manager: manager || "",
      joinDate: joinDate || "",  // ← ADD
    };

    // Employee record sync
    await Employee.findByIdAndUpdate(employee._id, {
      department,
      jobTitle,
      manager,
      joinDate, // ← ADD (agar Employee model mein hai)
    });

    await onboarding.save();

    return res.json({
      item: {
        id: String(onboarding._id),
        workInfo: onboarding.workInfo,
        overallStatus: onboarding.overallStatus,
        progress: await getProgress(onboarding),
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/onboarding/me/submit - Submit onboarding for review
router.post("/me/submit", requireAuth, async (req, res, next) => {
  try {
    const ctx = await requireEmployeeSelf(req, res);
    if (!ctx) return;
    const { user, employee } = ctx;

    const onboarding = await Onboarding.findOne({ userId: user._id });
    if (!onboarding) {
      return res.status(404).json({ error: { message: "Onboarding not found" } });
    }

    // Check if all steps are completed (submitted or verified) - W-4 is optional
    const docReady = (s) => s === "submitted" || s === "verified";
    if (!onboarding.basicInfo?.completed ||
        !docReady(onboarding.identityVerification?.primaryId?.status) ||
        !docReady(onboarding.identityVerification?.secondaryId?.status) ||
        !docReady(onboarding.employeeHandbook?.status) ||
        !docReady(onboarding.digitalSignature?.status)) {
      return res.status(400).json({
        error: { message: "Complete all steps before submitting" },
      });
    }

    onboarding.overallStatus = "submitted";
    await onboarding.save();

    // Notify admin
    await createNotification({
      actor: employee.name,
      actorRole: "employee",
      action: "submitted",
      resourceType: "onboarding",
      resourceName: employee.name,
      details: "employee onboarding for review",
      link: "/admin/onboarding",
    });

    return res.json({
      item: {
        id: String(onboarding._id),
        overallStatus: onboarding.overallStatus,
        progress: await getProgress(onboarding),
      },
      message: "Onboarding submitted for review",
    });
  } catch (err) {
    next(err);
  }
});

// ==================== ADMIN ENDPOINTS ====================

// GET /api/onboarding/admin/all - Get all onboarding records (Admin + Manager)
router.get("/admin/all", requireAuth, requireRole(["super-admin", "admin", "manager"]), async (req, res, next) => {
  try {
    const { status } = req.query;
    const filter = {};
    if (status) {
      filter.overallStatus = status;
    }

    const onboardings = await Onboarding.find(filter)
      .sort({ createdAt: -1 })
      .lean();

    const clearHires = await ClearHireProfile.find({}).select("userId status").lean();
    const chMap = {};
    clearHires.forEach((ch) => {
      chMap[ch.userId.toString()] = ch.status;
    });

    const mappedItems = onboardings.map((o) => ({
      id: String(o._id),
      userId: String(o.userId),
      employeeId: String(o.employeeId),
      employeeName: o.employeeName,
      basicInfo: o.basicInfo,
      identityVerification: o.identityVerification,
      w4Form: o.w4Form,
      employeeHandbook: o.employeeHandbook,
      digitalSignature: o.digitalSignature,
      workInfo: o.workInfo,
      overallStatus: o.overallStatus,
      progress: calculateProgress(o, chMap[o.userId.toString()]),
      adminReview: o.adminReview,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
    }));

    // Fetch all active/existing employees to check links
    const employees = await Employee.find({}).select("_id").lean();
    const employeeIdSet = new Set(employees.map((e) => String(e._id)));

    // Group items by employeeName (case-insensitive)
    const groups = {};
    mappedItems.forEach((item) => {
      const nameKey = String(item.employeeName || "").toLowerCase().trim();
      if (!groups[nameKey]) {
        groups[nameKey] = [];
      }
      groups[nameKey].push(item);
    });

    const items = [];
    for (const nameKey of Object.keys(groups)) {
      const groupItems = groups[nameKey];
      if (groupItems.length === 1) {
        items.push(groupItems[0]);
      } else {
        // Multiple records for the same employee name
        // 1. Separate records that map to an actual Employee ID
        const linkedRecords = groupItems.filter(
          (r) => employeeIdSet.has(r.employeeId) || employeeIdSet.has(r.userId)
        );
        const candidates = linkedRecords.length > 0 ? linkedRecords : groupItems;

        // 2. Choose the best record among candidates
        // Sort by progress desc, then by createdAt desc
        candidates.sort((a, b) => {
          if (a.progress !== b.progress) {
            return b.progress - a.progress; // highest progress first
          }
          return new Date(b.createdAt) - new Date(a.createdAt); // newest first
        });

        items.push(candidates[0]);
      }
    }

    // Sort items by createdAt desc to match the original sort order
    items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({ items });
  } catch (err) {
    next(err);
  }
});

// GET /api/onboarding/admin/:id - Get specific onboarding details (Admin)
router.get("/admin/:id", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const onboarding = await Onboarding.findById(req.params.id).lean();
    if (!onboarding) {
      return res.status(404).json({ error: { message: "Onboarding not found" } });
    }

    res.json({
      item: {
        id: String(onboarding._id),
        userId: String(onboarding.userId),
        employeeId: String(onboarding.employeeId),
        employeeName: onboarding.employeeName,
        basicInfo: onboarding.basicInfo,
        identityVerification: onboarding.identityVerification,
        w4Form: onboarding.w4Form,
        employeeHandbook: onboarding.employeeHandbook,
        digitalSignature: onboarding.digitalSignature,
        overallStatus: onboarding.overallStatus,
        progress: await getProgress(onboarding),
        adminReview: onboarding.adminReview,
        createdAt: onboarding.createdAt,
        updatedAt: onboarding.updatedAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/onboarding/admin/:id/approve - Approve onboarding (Admin)
router.put("/admin/:id/approve", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const { comments } = req.body;

    const onboarding = await Onboarding.findById(req.params.id);
    if (!onboarding) {
      return res.status(404).json({ error: { message: "Onboarding not found" } });
    }

    // Mark all submitted items as verified
    if (onboarding.identityVerification.primaryId.status === "submitted") {
      onboarding.identityVerification.primaryId.status = "verified";
    }
    if (onboarding.identityVerification.secondaryId.status === "submitted") {
      onboarding.identityVerification.secondaryId.status = "verified";
    }
    if (onboarding.w4Form.status === "submitted") {
      onboarding.w4Form.status = "verified";
    }
    if (onboarding.employeeHandbook.status === "submitted") {
      onboarding.employeeHandbook.status = "verified";
    }
    if (onboarding.digitalSignature.status === "submitted") {
      onboarding.digitalSignature.status = "verified";
    }

    onboarding.overallStatus = "approved";
    onboarding.adminReview = {
      reviewedBy: req.user.id,
      reviewedAt: new Date(),
      comments: comments || "",
    };

    await onboarding.save();

    // Auto-approve ClearHire background check profile if it exists
    try {
      const clearHireProfile = await ClearHireProfile.findOne({ userId: onboarding.userId });
      if (clearHireProfile) {
        clearHireProfile.status = "GREEN";
        await clearHireProfile.save();
      }
    } catch (err) {
      console.error("[onboarding approve] ClearHire status auto-approval failed:", err.message);
    }

    // Trigger Maine New Hire Reporting workflow
    try {
      const existingReport = await NewHireReport.findOne({ employeeId: onboarding.employeeId });
      if (!existingReport) {
        const employee = await Employee.findById(onboarding.employeeId);
        const clearHireProfile = await ClearHireProfile.findOne({ userId: onboarding.userId });
        
        let ssnEncrypted = "";
        let employeeAddress = { street: "", city: "", state: "", zip: "" };
        
        if (clearHireProfile) {
          ssnEncrypted = clearHireProfile.ssnEncrypted;
          // Grab current address from history
          const currentAddr = clearHireProfile.addressHistory?.find(a => !a.endDate);
          if (currentAddr) {
            employeeAddress = {
              street: currentAddr.street || "",
              city: currentAddr.city || "",
              state: currentAddr.state || "",
              zip: currentAddr.zip || ""
            };
          }
        }
        
        // If not found in background scan, fallback to basicInfo location
        if (!employeeAddress.street && onboarding.basicInfo?.location) {
          employeeAddress.street = onboarding.basicInfo.location;
          employeeAddress.city = "Portland";
          employeeAddress.state = "ME";
          employeeAddress.zip = "04101";
        }
        
        // Handle employer FEIN / details fallback
        let employerName = "Task Manager Corporation";
        let employerAddress = { street: "123 Federal St", city: "Portland", state: "ME", zip: "04101" };
        let employerFEIN = "12-3456789";
        
        if (employee && employee.company) {
          const company = await Company.findOne({
            $or: [
              { name: new RegExp(`^${employee.company}$`, "i") },
              { code: new RegExp(`^${employee.company}$`, "i") }
            ]
          });
          if (company) {
            employerName = company.name || employerName;
            employerFEIN = company.einNumber || employerFEIN;
            if (company.address) {
              employerAddress = {
                street: company.address.street || employerAddress.street,
                city: company.address.city || employerAddress.city,
                state: company.address.state || employerAddress.state,
                zip: company.address.zipCode || employerAddress.zip
              };
            }
          }
        }

        const hireDate = employee?.joinDate || employee?.createdAt || new Date();
        const countdownExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

        if (ssnEncrypted) {
          await NewHireReport.create({
            employeeId: onboarding.employeeId,
            onboardingId: onboarding._id,
            stateCode: "ME",
            employeeName: onboarding.employeeName,
            employeeAddress,
            ssnEncrypted,
            hireDate,
            employerName,
            employerAddress,
            employerFEIN,
            status: "pending",
            countdownExpiry
          });
          console.log(`[New Hire Reporting] Created pending Maine report for ${onboarding.employeeName}. Deadline: ${countdownExpiry.toISOString()}`);
        } else {
          console.warn(`[New Hire Reporting] Skipping report for ${onboarding.employeeName} due to missing SSN in ClearHireProfile.`);
        }
      }
    } catch (triggerErr) {
      console.error("[New Hire Reporting] Trigger initialization failed:", triggerErr.message);
    }

    // Notify employee
    await createNotification({
      actor: req.user.username || req.user.name || "Admin",
      actorRole: "admin",
      action: "approved",
      resourceType: "onboarding",
      resourceName: onboarding.employeeName,
      details: comments || "Onboarding approved",
      resourceId: String(onboarding._id),
    });

    res.json({
      item: {
        id: String(onboarding._id),
        overallStatus: onboarding.overallStatus,
        progress: await getProgress(onboarding),
      },
      message: "Onboarding approved successfully",
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/onboarding/admin/:id/reject - Reject onboarding (Admin)
router.put("/admin/:id/reject", requireAuth, requireRole(["super-admin", "admin"]), async (req, res, next) => {
  try {
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({ error: { message: "Rejection reason is required" } });
    }

    const onboarding = await Onboarding.findById(req.params.id);
    if (!onboarding) {
      return res.status(404).json({ error: { message: "Onboarding not found" } });
    }

    onboarding.overallStatus = "rejected";
    onboarding.adminReview = {
      reviewedBy: req.user.id,
      reviewedAt: new Date(),
      comments: "",
      rejectionReason: reason,
    };

    await onboarding.save();

    // Notify employee
    await createNotification({
      actor: req.user.username || req.user.name || "Admin",
      actorRole: "admin",
      action: "rejected",
      resourceType: "onboarding",
      resourceName: onboarding.employeeName,
      details: reason,
      resourceId: String(onboarding._id),
    });

    res.json({
      item: {
        id: String(onboarding._id),
        overallStatus: onboarding.overallStatus,
        progress: await getProgress(onboarding),
      },
      message: "Onboarding rejected",
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
