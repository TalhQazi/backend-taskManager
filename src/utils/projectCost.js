const ExpenseItem = require("../models/ExpenseItem");

async function getProjectCost(projectId) {
  const items = await ExpenseItem.find({ projectId });

  let estimated = 0;
  let actual = 0;

  items.forEach((i) => {
    estimated += i.estimatedCost || 0;
    actual += i.actualCost || 0;
  });

  return {
    totalEstimated: estimated,
    totalActual: actual,
    variance: estimated - actual,
  };
}

module.exports = { getProjectCost };