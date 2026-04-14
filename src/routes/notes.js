const express = require("express");
const Note = require("../models/Note");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// Get all notes for the current user
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.sub || req.user.id;
    const notes = await Note.find({ userId }).sort({ isPinned: -1, updatedAt: -1 });
    res.json({ items: notes.map(n => ({ ...n.toObject(), id: n._id })) });
  } catch (err) {
    next(err);
  }
});

// Create a new note
router.post("/", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.sub || req.user.id;
    const { title, content, color, isPinned } = req.body;
    
    const note = await Note.create({
      userId,
      title: title || "",
      content: content || "",
      color: color || "#ffffff",
      isPinned: isPinned || false
    });
    
    res.status(201).json({ item: { ...note.toObject(), id: note._id } });
  } catch (err) {
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
    
    res.json({ item: { ...note.toObject(), id: note._id } });
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
