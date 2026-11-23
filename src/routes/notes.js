const express = require("express");
const Note = require("../models/Note");
const { requireAuth } = require("../middleware/auth");
const { getAuthorProfileMap, getAuthorProfile } = require("../utils/authorProfile");

const router = express.Router();

// Get all notes for the current user
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.sub || req.user.id;
    const notes = await Note.find({ userId }).sort({ isPinned: -1, updatedAt: -1 });
    const profile = await getAuthorProfile(userId);
    res.json({
      items: notes.map((n) => {
        const obj = n.toObject();
        return {
          ...obj,
          id: n._id,
          createdBy: {
            id: userId,
            name: profile.fullName || (obj.createdBy && obj.createdBy.name) || "User",
            avatar: profile.avatar || (obj.createdBy && obj.createdBy.avatar) || "",
            role: (obj.createdBy && obj.createdBy.role) || "Member",
          },
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

// Create a new note
router.post("/", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.sub || req.user.id;
    console.log("Creating note for user:", userId);
    
    if (!userId) {
      return res.status(401).json({ error: { message: "User ID not found" } });
    }

    const profile = await getAuthorProfile(userId);
    const { title, content, overview, color, isPinned, isFavorite, folder, tags, actionItems, notesList, attachments } = req.body;
    
    const note = await Note.create({
      userId,
      createdBy: {
        id: userId,
        name: profile.fullName || (req.body.createdBy && req.body.createdBy.name) || "User",
        avatar: profile.avatar || (req.body.createdBy && req.body.createdBy.avatar) || "",
        role: (req.body.createdBy && req.body.createdBy.role) || "Admin",
      },
      title: title || "",
      overview: overview || content || "",
      content: content || overview || "",
      color: color || "#ffffff",
      isPinned: !!isPinned,
      isFavorite: !!isFavorite,
      folder: folder || "",
      tags: tags || [],
      actionItems: actionItems || [],
      notesList: notesList || [],
      attachments: attachments || []
    });
    
    console.log("Note created:", note._id);
    res.status(201).json({
      item: {
        ...note.toObject(),
        id: note._id,
        createdBy: {
          id: userId,
          name: profile.fullName || "User",
          avatar: profile.avatar || "",
          role: "Admin",
        },
      },
    });
  } catch (err) {
    console.error("Note creation error:", err);
    next(err);
  }
});

// Update a note
router.patch("/:id", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.sub || req.user.id;
    const note = await Note.findOneAndUpdate(
      { _id: req.params.id, userId },
      { $set: req.body },
      { new: true }
    );
    
    if (!note) {
      return res.status(404).json({ error: { message: "Note not found or unauthorized" } });
    }
    
    const profile = await getAuthorProfile(userId);
    res.json({
      item: {
        ...note.toObject(),
        id: note._id,
        createdBy: {
          id: userId,
          name: profile.fullName || (note.createdBy && note.createdBy.name) || "User",
          avatar: profile.avatar || (note.createdBy && note.createdBy.avatar) || "",
          role: (note.createdBy && note.createdBy.role) || "Member",
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

// Delete a note
router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.sub || req.user.id;
    const note = await Note.findOneAndDelete({ _id: req.params.id, userId });
    
    if (!note) {
      return res.status(404).json({ error: { message: "Note not found or unauthorized" } });
    }
    
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
