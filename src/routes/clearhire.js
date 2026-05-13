/**
 * ClearHire® API Routes
 * ─────────────────────
 * POST   /api/clearhire/submit        — Submit applicant for screening
 * GET    /api/clearhire/status/:userId — Get screening status
 * POST   /api/clearhire/recheck       — Re-run background check
 * POST   /api/clearhire/override      — Admin override YELLOW → GREEN
 */

const express = require("express");
const { z } = require("zod");
const { requireAuth, requireRole } = require("../middleware/auth");
const ClearHireProfile = require("../models/ClearHireProfile");
const ActivityLog = require("../models/ActivityLog");
const { encryptField, maskSSN } = require("../utils/encryption");

const router = express.Router();

// ─── Validation Schemas ────────────────────────────────────────────────────────

const addressSchema = z.object({
  street: z.string().min(1, "Street is required"),
  city: z.string().min(1, "City is required"),
  state: z.string().min(1, "State is required"),
  zip: z.string().min(1, "ZIP code is required"),
  startDate: z.string().min(1, "Start date is required"),
  endDate: z.string().optional().nullable(),
});

const submitSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
  employeeId: z.string().optional(),
  fullName: z.string().min(2, "Full legal name is required"),
  dob: z.string().min(1, "Date of birth is required"),
  ssn: z
    .string()
    .transform((v) => v.replace(/\D/g, ""))
    .refine((v) => v.length === 9, "SSN must be exactly 9 digits"),
  addressHistory: z
    .array(addressSchema)
    .min(1, "At least one address is required"),
  governmentIdUrl: z.string().optional().default(""),
  selfieUrl: z.string().optional().default(""),
  fcraConsentGiven: z
    .boolean()
    .refine((v) => v === true, "FCRA consent is required before running a background check"),
});

const recheckSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
});

const overrideSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
  reason: z.string().min(5, "Override reason must be at least 5 characters"),
});

// ─── Risk Scoring Engine (Section 6) ───────────────────────────────────────────

/**
 * Calculate risk score from background check results.
 *
 * Scoring rules from the task document:
 *   Sex offender match → AUTO FAIL (RED, score 999)
 *   Violent felony     → +100
 *   Fraud/theft        → +60
 *   Multiple offenses  → +40
 *   No record          → 0
 *
 * Score → Status:
 *   0–20  = GREEN
 *   21–60 = YELLOW
 *   61+   = RED
 */
function calculateRiskScore(checkResults) {
  let score = 0;
  const flags = [];

  // AUTO FAIL — sex offender registry match
  if (checkResults.sexOffenderMatch) {
    return {
      score: 999,
      status: "RED",
      flags: ["Sex offender registry match — AUTO FAIL"],
    };
  }

  if (checkResults.violentFelony) {
    score += 100;
    flags.push("Violent felony");
  }
  if (checkResults.fraudTheft) {
    score += 60;
    flags.push("Fraud/theft");
  }
  if (checkResults.multipleOffenses) {
    score += 40;
    flags.push("Multiple offenses");
  }

  let status = "GREEN";
  if (score >= 61) status = "RED";
  else if (score >= 21) status = "YELLOW";

  return { score, status, flags };
}

// ─── Stubbed External API Calls ────────────────────────────────────────────────
// These return mock data until real API keys are provided (Module 6).

/**
 * STUB: Query NSOPW / sex offender registry aggregator.
 * Real implementation will call Offenders.io or Intsurfing API.
 */
async function checkSexOffenderRegistry(/* fullName, dob, addresses */) {
  // Simulate network delay
  await new Promise((r) => setTimeout(r, 500));
  return { match: false };
}

/**
 * STUB: Run Checkr background check.
 * Real implementation will call Checkr API v1.
 */
async function runCheckrBackgroundCheck(/* candidateData */) {
  // Simulate network delay
  await new Promise((r) => setTimeout(r, 1000));
  return {
    candidateId: `stub_${Date.now()}`,
    reportId: `stub_rpt_${Date.now()}`,
    violentFelony: false,
    fraudTheft: false,
    multipleOffenses: false,
  };
}

/**
 * STUB: Validate address via SmartyStreets/USPS.
 * Real implementation will call address validation API.
 */
async function validateAddresses(/* addressHistory */) {
  await new Promise((r) => setTimeout(r, 300));
  return { valid: true, issues: [] };
}

// ─── Helper: Log ClearHire activity ────────────────────────────────────────────

async function logClearHireActivity(action, req, profile, description) {
  try {
    await ActivityLog.create({
      actorUserId: req.user?.sub || "system",
      actorUsername: req.user?.username || "system",
      actorRole: req.user?.role || "system",
      action,
      resourceType: "clearhire",
      resourceId: String(profile.userId),
      resourceName: profile.fullName,
      description,
      ipAddress: String(req.ip || req.headers["x-forwarded-for"] || ""),
      userAgent: String(req.headers["user-agent"] || ""),
      metadata: {
        clearHireProfileId: String(profile._id),
        status: profile.status,
        riskScore: profile.riskScore,
      },
    });
  } catch (err) {
    console.error("[ClearHire] Audit log error:", err.message);
  }
}

// ─── Routes ────────────────────────────────────────────────────────────────────

/**
 * POST /api/clearhire/submit
 * Submit applicant data and trigger background check.
 */
router.post(
  "/submit",
  requireAuth,
  // allow employees so they can self-onboard
  async (req, res, next) => {
    try {
      const parsed = submitSchema.safeParse(req.body);
      if (!parsed.success) {
        const messages = parsed.error.errors.map((e) => e.message).join("; ");
        return res.status(400).json({ error: { message: messages } });
      }

      const data = parsed.data;

      // Security check: employees can only submit for themselves
      if (req.user?.role === "employee" && data.userId !== "me" && data.userId !== req.user.sub) {
        return res.status(403).json({ error: { message: "Employees can only submit their own screening" } });
      }

      // Resolve 'me' to actual user ID
      if (data.userId === "me") {
        data.userId = req.user.sub;
      }

      // Check if profile already exists for this user
      const existing = await ClearHireProfile.findOne({ userId: data.userId }).lean();
      if (existing) {
        return res.status(409).json({
          error: {
            message: "A ClearHire profile already exists for this user. Use /recheck to re-run.",
          },
        });
      }

      // Encrypt SSN
      const ssnEncrypted = encryptField(data.ssn);

      // Create initial profile with PENDING status
      const profile = await ClearHireProfile.create({
        userId: data.userId,
        employeeId: data.employeeId || undefined,
        fullName: data.fullName,
        dob: new Date(data.dob),
        ssnEncrypted,
        addressHistory: data.addressHistory.map((a) => ({
          ...a,
          startDate: new Date(a.startDate),
          endDate: a.endDate ? new Date(a.endDate) : undefined,
        })),
        governmentIdUrl: data.governmentIdUrl,
        selfieUrl: data.selfieUrl,
        fcraConsentGiven: data.fcraConsentGiven,
        fcraConsentDate: new Date(),
        status: "PENDING",
      });

      // Log submission
      await logClearHireActivity(
        "CLEARHIRE_SUBMIT",
        req,
        profile,
        `${req.user.username} submitted ClearHire screening for "${data.fullName}"`
      );

      // ── Run background checks (stubbed) ──
      const [nsopwResult, checkrResult] = await Promise.all([
        checkSexOffenderRegistry(data.fullName, data.dob, data.addressHistory),
        runCheckrBackgroundCheck({
          fullName: data.fullName,
          dob: data.dob,
          ssn: data.ssn, // sent to Checkr, not stored raw
          addresses: data.addressHistory,
        }),
      ]);

      // Validate addresses (non-blocking — just for data quality)
      validateAddresses(data.addressHistory).catch(() => {});

      // ── Calculate risk score ──
      const riskResult = calculateRiskScore({
        sexOffenderMatch: nsopwResult.match,
        violentFelony: checkrResult.violentFelony,
        fraudTheft: checkrResult.fraudTheft,
        multipleOffenses: checkrResult.multipleOffenses,
      });

      // ── Update profile with results ──
      profile.riskScore = riskResult.score;
      profile.status = riskResult.status;
      profile.flags = riskResult.flags;
      profile.lastChecked = new Date();
      profile.checkrCandidateId = checkrResult.candidateId;
      profile.checkrReportId = checkrResult.reportId;
      profile.nsopwResult = nsopwResult;

      // Parallelize save and log
      await Promise.all([
        profile.save(),
        logClearHireActivity(
          "CLEARHIRE_SCAN_COMPLETE",
          req,
          profile,
          `ClearHire scan completed for "${data.fullName}" — Status: ${riskResult.status}, Score: ${riskResult.score}`
        )
      ]);

      return res.status(201).json({
        item: {
          id: String(profile._id),
          userId: String(profile.userId),
          fullName: profile.fullName,
          status: profile.status,
          score: profile.riskScore,
          flags: profile.flags,
          lastChecked: profile.lastChecked,
        },
      });
    } catch (err) {
      return next(err);
    }
  }
);

/**
 * GET /api/clearhire/status/:userId
 * Get the ClearHire status for a user.
 * Any authenticated user can check their own status.
 * Admins can check anyone's status.
 */
router.get("/status/:userId", requireAuth, async (req, res, next) => {
  try {
    const targetUserId = req.params.userId === "me" ? req.user?.sub : req.params.userId;
    const requestingUserId = req.user?.sub;
    const requestingRole = req.user?.role;

    // Non-admin users can only check their own status
    if (
      !["super-admin", "admin", "manager"].includes(requestingRole) &&
      targetUserId !== requestingUserId
    ) {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }

    const profile = await ClearHireProfile.findOne({ userId: targetUserId })
      .select("-ssnEncrypted -nsopwResult") // Never expose encrypted SSN or raw results
      .lean();

    if (!profile) {
      return res.status(404).json({
        error: { message: "No ClearHire profile found for this user" },
      });
    }

    return res.json({
      item: {
        id: String(profile._id),
        userId: String(profile.userId),
        fullName: profile.fullName,
        status: profile.status,
        score: profile.riskScore,
        flags: profile.flags,
        lastChecked: profile.lastChecked,
        fcraConsentGiven: profile.fcraConsentGiven,
        fcraConsentDate: profile.fcraConsentDate,
        adminOverride: profile.adminOverride?.overriddenBy
          ? {
              overriddenAt: profile.adminOverride.overriddenAt,
              previousStatus: profile.adminOverride.previousStatus,
              reason: profile.adminOverride.reason,
            }
          : null,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
      },
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/clearhire/recheck
 * Re-run the background check for an existing profile.
 */
router.post(
  "/recheck",
  requireAuth,
  requireRole(["super-admin", "admin"]),
  async (req, res, next) => {
    try {
      const parsed = recheckSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: { message: "User ID is required" } });
      }

      const profile = await ClearHireProfile.findOne({ userId: parsed.data.userId });
      if (!profile) {
        return res.status(404).json({
          error: { message: "No ClearHire profile found for this user" },
        });
      }

      // Re-run background checks (stubbed)
      const [nsopwResult, checkrResult] = await Promise.all([
        checkSexOffenderRegistry(),
        runCheckrBackgroundCheck(),
      ]);

      const riskResult = calculateRiskScore({
        sexOffenderMatch: nsopwResult.match,
        violentFelony: checkrResult.violentFelony,
        fraudTheft: checkrResult.fraudTheft,
        multipleOffenses: checkrResult.multipleOffenses,
      });

      profile.riskScore = riskResult.score;
      profile.status = riskResult.status;
      profile.flags = riskResult.flags;
      profile.lastChecked = new Date();
      profile.recheckCount += 1;
      profile.checkrCandidateId = checkrResult.candidateId;
      profile.checkrReportId = checkrResult.reportId;
      profile.nsopwResult = nsopwResult;

      await Promise.all([
        profile.save(),
        logClearHireActivity(
          "CLEARHIRE_RECHECK",
          req,
          profile,
          `${req.user.username} triggered ClearHire recheck for "${profile.fullName}" — Status: ${riskResult.status}`
        )
      ]);

      return res.json({
        item: {
          id: String(profile._id),
          userId: String(profile.userId),
          fullName: profile.fullName,
          status: profile.status,
          score: profile.riskScore,
          flags: profile.flags,
          lastChecked: profile.lastChecked,
          recheckCount: profile.recheckCount,
        },
      });
    } catch (err) {
      return next(err);
    }
  }
);

/**
 * POST /api/clearhire/override
 * Admin override: change YELLOW → GREEN with mandatory reason + audit trail.
 * RED status CANNOT be overridden — only YELLOW.
 */
router.post(
  "/override",
  requireAuth,
  requireRole(["super-admin", "admin"]),
  async (req, res, next) => {
    try {
      const parsed = overrideSchema.safeParse(req.body);
      if (!parsed.success) {
        const messages = parsed.error.errors.map((e) => e.message).join("; ");
        return res.status(400).json({ error: { message: messages } });
      }

      const profile = await ClearHireProfile.findOne({ userId: parsed.data.userId });
      if (!profile) {
        return res.status(404).json({
          error: { message: "No ClearHire profile found for this user" },
        });
      }

      if (profile.status !== "YELLOW") {
        return res.status(400).json({
          error: {
            message: `Cannot override status "${profile.status}". Only YELLOW status can be overridden.`,
          },
        });
      }

      const previousStatus = profile.status;
      profile.status = "GREEN";
      profile.adminOverride = {
        overriddenBy: req.user.sub,
        overriddenAt: new Date(),
        previousStatus,
        reason: parsed.data.reason,
      };

      await Promise.all([
        profile.save(),
        logClearHireActivity(
          "CLEARHIRE_OVERRIDE",
          req,
          profile,
          `${req.user.username} overrode ClearHire status for "${profile.fullName}" from ${previousStatus} → GREEN. Reason: ${parsed.data.reason}`
        )
      ]);

      return res.json({
        item: {
          id: String(profile._id),
          userId: String(profile.userId),
          fullName: profile.fullName,
          status: profile.status,
          score: profile.riskScore,
          flags: profile.flags,
          adminOverride: {
            overriddenAt: profile.adminOverride.overriddenAt,
            previousStatus: profile.adminOverride.previousStatus,
            reason: profile.adminOverride.reason,
          },
        },
      });
    } catch (err) {
      return next(err);
    }
  }
);

/**
 * GET /api/clearhire/all
 * Admin-only: list all ClearHire profiles with optional status filter.
 */
router.get(
  "/all",
  requireAuth,
  requireRole(["super-admin", "admin"]),
  async (req, res, next) => {
    try {
      const filter = {};
      if (req.query.status && ["GREEN", "YELLOW", "RED", "PENDING"].includes(req.query.status)) {
        filter.status = req.query.status;
      }

      const profiles = await ClearHireProfile.find(filter)
        .select("-ssnEncrypted -nsopwResult")
        .sort({ updatedAt: -1 })
        .lean();

      return res.json({
        items: profiles.map((p) => ({
          id: String(p._id),
          userId: String(p.userId),
          employeeId: p.employeeId ? String(p.employeeId) : null,
          fullName: p.fullName,
          status: p.status,
          score: p.riskScore,
          flags: p.flags,
          lastChecked: p.lastChecked,
          adminOverride: p.adminOverride?.overriddenBy
            ? {
                overriddenAt: p.adminOverride.overriddenAt,
                previousStatus: p.adminOverride.previousStatus,
                reason: p.adminOverride.reason,
              }
            : null,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
        })),
        total: profiles.length,
      });
    } catch (err) {
      return next(err);
    }
  }
);

module.exports = router;
