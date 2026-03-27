const express = require("express");
const Credential = require("../models/Credential");
const { requireAuth } = require("../middleware/auth");
const crypto = require("crypto");

const router = express.Router();

// Encryption key - in production, use environment variable
const ENCRYPTION_KEY = process.env.CREDENTIAL_ENCRYPTION_KEY || "your-secret-key-change-in-production";

// Simple encryption/decryption functions
const encrypt = (text) => {
  if (!text) return "";
  const cipher = crypto.createCipher("aes-256-cbc", ENCRYPTION_KEY);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return encrypted;
};

const decrypt = (text) => {
  if (!text) return "";
  try {
    const decipher = crypto.createDecipher("aes-256-cbc", ENCRYPTION_KEY);
    let decrypted = decipher.update(text, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    return text; // Return original if decryption fails
  }
};

// Get all credentials (requires auth and admin role)
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const role = String(req.user?.role || "").toLowerCase();
    if (role !== "admin" && role !== "super-admin") {
      return res.status(403).json({ error: { message: "Forbidden: Admin access required" } });
    }

    const credentials = await Credential.find()
      .sort({ createdAt: -1 })
      .lean();

    // Decrypt sensitive fields for display
    const decryptedCredentials = credentials.map((cred) => ({
      ...cred,
      passwordHash: cred.passwordHash ? "••••••••" : "",
      apiKey: cred.apiKey ? "••••••••" : "",
    }));

    res.json({ items: decryptedCredentials });
  } catch (err) {
    next(err);
  }
});

// Create new credential (requires auth and admin role) - MUST come before /:id route
router.post("/", requireAuth, async (req, res, next) => {
  try {
    const role = String(req.user?.role || "").toLowerCase();
    if (role !== "admin" && role !== "super-admin") {
      return res.status(403).json({ error: { message: "Forbidden: Admin access required" } });
    }

    const { resourceName, resourceType, username, passwordHash, apiKey, ...rest } = req.body;

    if (!resourceName || !resourceType || !username) {
      return res.status(400).json({
        error: { message: "resourceName, resourceType, and username are required" },
      });
    }

    const newCredential = new Credential({
      resourceName,
      resourceType,
      username,
      passwordHash: passwordHash ? encrypt(passwordHash) : "",
      apiKey: apiKey ? encrypt(apiKey) : "",
      ...rest,
      createdBy: req.user?.username || "System",
      accessLog: [
        {
          accessedAt: new Date(),
          accessedBy: req.user?.username || "System",
          action: "created",
        },
      ],
    });

    await newCredential.save();
    res.status(201).json({
      item: {
        ...newCredential.toObject(),
        passwordHash: newCredential.passwordHash ? "••••••••" : "",
        apiKey: newCredential.apiKey ? "••••••••" : "",
      },
    });
  } catch (err) {
    next(err);
  }
});

// Get single credential by ID (requires auth and admin role)
router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const role = String(req.user?.role || "").toLowerCase();
    if (role !== "admin" && role !== "super-admin") {
      return res.status(403).json({ error: { message: "Forbidden: Admin access required" } });
    }

    const credential = await Credential.findById(req.params.id).lean();
    if (!credential) {
      return res.status(404).json({ error: { message: "Credential not found" } });
    }

    // Log access
    await Credential.findByIdAndUpdate(req.params.id, {
      $push: {
        accessLog: {
          accessedAt: new Date(),
          accessedBy: req.user?.username || "System",
          action: "view",
        },
      },
    });

    res.json({
      item: {
        ...credential,
        passwordHash: credential.passwordHash ? decrypt(credential.passwordHash) : "",
        apiKey: credential.apiKey ? decrypt(credential.apiKey) : "",
      },
    });
  } catch (err) {
    next(err);
  }
});

// Update credential (requires auth and admin role)
router.put("/:id", requireAuth, async (req, res, next) => {
  try {
    const role = String(req.user?.role || "").toLowerCase();
    if (role !== "admin" && role !== "super-admin") {
      return res.status(403).json({ error: { message: "Forbidden: Admin access required" } });
    }

    const { passwordHash, apiKey, ...rest } = req.body;

    const updateData = {
      ...rest,
      passwordHash: passwordHash ? encrypt(passwordHash) : undefined,
      apiKey: apiKey ? encrypt(apiKey) : undefined,
    };

    // Remove undefined fields
    Object.keys(updateData).forEach(
      (key) => updateData[key] === undefined && delete updateData[key]
    );

    const credential = await Credential.findByIdAndUpdate(
      req.params.id,
      {
        ...updateData,
        $push: {
          accessLog: {
            accessedAt: new Date(),
            accessedBy: req.user?.username || "System",
            action: "updated",
          },
        },
      },
      { new: true, runValidators: true }
    );

    if (!credential) {
      return res.status(404).json({ error: { message: "Credential not found" } });
    }

    res.json({
      item: {
        ...credential.toObject(),
        passwordHash: credential.passwordHash ? "••••••••" : "",
        apiKey: credential.apiKey ? "••••••••" : "",
      },
    });
  } catch (err) {
    next(err);
  }
});

// Delete credential (requires auth and admin role)
router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const role = String(req.user?.role || "").toLowerCase();
    if (role !== "admin" && role !== "super-admin") {
      return res.status(403).json({ error: { message: "Forbidden: Admin access required" } });
    }

    const credential = await Credential.findByIdAndDelete(req.params.id);
    if (!credential) {
      return res.status(404).json({ error: { message: "Credential not found" } });
    }

    res.json({ message: "Credential deleted successfully" });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
