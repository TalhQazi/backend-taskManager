const ExpenseItem = require("../models/ExpenseItem");
const ExpenseSheet = require("../models/ExpenseSheet");

async function updateSheetTotal(sheetId) {
  if (!sheetId) return;

  const items = await ExpenseItem.find({ sheetId });

  const total = items.reduce((sum, item) => sum + (item.totalPrice || 0), 0);

  await ExpenseSheet.findByIdAndUpdate(sheetId, {
    totalAmount: total,
  });
}

module.exports = {
  updateSheetTotal,
};