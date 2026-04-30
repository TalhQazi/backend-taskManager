const express = require("express");
const router = express.Router();
const ExpenseSheet = require("../models/ExpenseSheet");


router.post("/", async (req, res) => {
  const sheet = await ExpenseSheet.create(req.body);
  res.json(sheet);
});


router.get("/:projectId", async (req, res) => {
  const sheets = await ExpenseSheet.find({
    projectId: req.params.projectId,
  });

  res.json(sheets);
});

module.exports = router;