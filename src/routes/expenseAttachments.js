const express = require("express");
const router = express.Router();
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const ExpenseAttachment = require("../models/ExpenseAttachment");

// ✅ Absolute path (important)
const uploadDir = path.join(__dirname, "../../uploads/expense");

// ✅ Ensure directory exists (prevents ENOENT error)
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// 🔥 Multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + "-" + file.originalname.replace(/\s+/g, "_");
    cb(null, uniqueName);
  },
});

// ✅ Optional: file filter (images + docs only)
const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Unsupported file type"), false);
  }
};

// ✅ Limits (important for security)
const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// ✅ Upload attachment
router.post("/", upload.array("files", 10), async (req, res) => {
  try {
    const { itemId } = req.body;

    if (!itemId) {
      return res.status(400).json({ error: "itemId is required" });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    const saved = await Promise.all(
      req.files.map((file) =>
        ExpenseAttachment.create({
          itemId,
          fileUrl: `/uploads/expense/${file.filename}`,
          fileName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
        })
      )
    );

    res.json(saved);
  } catch (err) {
    console.error("Upload Error:", err.message);
    res.status(500).json({ error: err.message || "Upload failed" });
  }
});


router.get("/:itemId", async (req, res) => {
  try {
    const attachments = await ExpenseAttachment.find({
      itemId: req.params.itemId,
    });

    res.json(attachments);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch attachments" });
  }
});

module.exports = router;