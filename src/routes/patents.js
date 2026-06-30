const express = require("express");
const Patent = require("../models/Patent");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// Helper function to calculate expiration
const calculateExpiration = (filingDate, filingType) => {
  if (!filingDate) return null;
  const date = new Date(filingDate);
  if (filingType === "Provisional") {
    date.setFullYear(date.getFullYear() + 1);
  } else {
    date.setFullYear(date.getFullYear() + 20);
  }
  return date;
};

// Helper function to check if expiring soon
const isExpiringExpiringSoon = (expirationDate) => {
  if (!expirationDate) return false;
  const today = new Date();
  const daysUntilExpiration = Math.ceil(
    (new Date(expirationDate) - today) / (1000 * 60 * 60 * 24)
  );
  return daysUntilExpiration <= 60 && daysUntilExpiration > 0;
};

// Get expiration watch (patents expiring within 180 days) - MUST come before /:id route
router.get("/expiration-watch", async (req, res, next) => {
  try {
    const patents = await Patent.find({ patentType: "filed" })
      .sort({ filingDate: 1 })
      .lean();

    const today = new Date();
    const expiringPatents = patents
      .map((patent) => {
        const expiration = calculateExpiration(patent.filingDate, patent.filingType);
        if (!expiration) return null;

        const daysUntilExpiration = Math.ceil(
          (expiration - today) / (1000 * 60 * 60 * 24)
        );

        return {
          ...patent,
          provisionalExpiration: expiration,
          daysUntilExpiration,
        };
      })
      .filter(
        (patent) =>
          patent &&
          patent.daysUntilExpiration >= 0 &&
          patent.daysUntilExpiration <= 180
      )
      .sort((a, b) => a.daysUntilExpiration - b.daysUntilExpiration);

    res.json({ items: expiringPatents });
  } catch (err) {
    next(err);
  }
});

// Get all filed patents
router.get("/filed", async (req, res, next) => {
  try {
    const patents = await Patent.find({ patentType: "filed" })
      .sort({ patentName: 1 })
      .lean();

    // Calculate expiration for each patent
    const enrichedPatents = patents.map((patent) => {
      const expiration = calculateExpiration(patent.filingDate, patent.filingType);
      const isExpiring = isExpiringExpiringSoon(expiration);

      return {
        ...patent,
        provisionalExpiration: expiration,
        isExpiringExpiringSoon: isExpiring,
      };
    });

    res.json({ items: enrichedPatents });
  } catch (err) {
    next(err);
  }
});

// Get all pending patents
router.get("/pending", async (req, res, next) => {
  try {
    const patents = await Patent.find({ patentType: "pending" })
      .sort({ patentName: 1 })
      .lean();
    res.json({ items: patents });
  } catch (err) {
    next(err);
  }
});

// Get single patent by ID
router.get("/:id", async (req, res, next) => {
  try {
    const patent = await Patent.findById(req.params.id).lean();
    if (!patent) {
      return res.status(404).json({ error: { message: "Patent not found" } });
    }

    if (patent.patentType === "filed") {
      const expiration = calculateExpiration(patent.filingDate, patent.filingType);
      return res.json({
        item: {
          ...patent,
          provisionalExpiration: expiration,
          isExpiringExpiringSoon: isExpiringExpiringSoon(expiration),
        },
      });
    }

    res.json({ item: patent });
  } catch (err) {
    next(err);
  }
});

// ── Sub-path aliases used by the frontend (/filed/:id, /pending/:id) ──

router.post("/filed", requireAuth, async (req, res, next) => {
  req.body.patentType = "filed";
  try {
    const { patentName } = req.body;
    if (!patentName) return res.status(400).json({ error: { message: "patentName is required" } });
    const newPatent = new Patent({ ...req.body, createdBy: req.user?.username || "System" });
    await newPatent.save();
    res.status(201).json({ item: newPatent });
  } catch (err) { next(err); }
});

router.post("/pending", requireAuth, async (req, res, next) => {
  req.body.patentType = "pending";
  try {
    const { patentName } = req.body;
    if (!patentName) return res.status(400).json({ error: { message: "patentName is required" } });
    const newPatent = new Patent({ ...req.body, createdBy: req.user?.username || "System" });
    await newPatent.save();
    res.status(201).json({ item: newPatent });
  } catch (err) { next(err); }
});

router.put("/filed/:id", requireAuth, async (req, res, next) => {
  try {
    const patent = await Patent.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!patent) return res.status(404).json({ error: { message: "Patent not found" } });
    const expiration = calculateExpiration(patent.filingDate, patent.filingType);
    res.json({ item: { ...patent.toObject(), provisionalExpiration: expiration, isExpiringExpiringSoon: isExpiringExpiringSoon(expiration) } });
  } catch (err) { next(err); }
});

router.put("/pending/:id", requireAuth, async (req, res, next) => {
  try {
    const patent = await Patent.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!patent) return res.status(404).json({ error: { message: "Patent not found" } });
    res.json({ item: patent });
  } catch (err) { next(err); }
});

router.delete("/filed/:id", requireAuth, async (req, res, next) => {
  try {
    const patent = await Patent.findByIdAndDelete(req.params.id);
    if (!patent) return res.status(404).json({ error: { message: "Patent not found" } });
    res.json({ message: "Patent deleted successfully" });
  } catch (err) { next(err); }
});

router.delete("/pending/:id", requireAuth, async (req, res, next) => {
  try {
    const patent = await Patent.findByIdAndDelete(req.params.id);
    if (!patent) return res.status(404).json({ error: { message: "Patent not found" } });
    res.json({ message: "Patent deleted successfully" });
  } catch (err) { next(err); }
});

// ── Generic routes ──

// Create new patent (requires auth)
router.post("/", requireAuth, async (req, res, next) => {
  try {
    const { patentName, patentType, ...rest } = req.body;

    if (!patentName || !patentType) {
      return res.status(400).json({
        error: { message: "patentName and patentType are required" },
      });
    }

    const newPatent = new Patent({
      patentName,
      patentType,
      ...rest,
      createdBy: req.user?.username || "System",
    });

    await newPatent.save();
    res.status(201).json({ item: newPatent });
  } catch (err) {
    next(err);
  }
});

// Update patent (requires auth)
router.put("/:id", requireAuth, async (req, res, next) => {
  try {
    const patent = await Patent.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    if (!patent) {
      return res.status(404).json({ error: { message: "Patent not found" } });
    }

    if (patent.patentType === "filed") {
      const expiration = calculateExpiration(patent.filingDate, patent.filingType);
      return res.json({
        item: {
          ...patent.toObject(),
          provisionalExpiration: expiration,
          isExpiringExpiringSoon: isExpiringExpiringSoon(expiration),
        },
      });
    }

    res.json({ item: patent });
  } catch (err) {
    next(err);
  }
});

// Delete patent (requires auth)
router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const patent = await Patent.findByIdAndDelete(req.params.id);
    if (!patent) {
      return res.status(404).json({ error: { message: "Patent not found" } });
    }
    res.json({ message: "Patent deleted successfully" });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
