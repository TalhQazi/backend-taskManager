require("dotenv").config();
const { connectDb } = require("./lib/db");
const CRMContact = require("./models/CRMContact");
const CRMDeal = require("./models/CRMDeal");
const CRMTask = require("./models/CRMTask");
const CRMCommunication = require("./models/CRMCommunication");
const CRMBehavioralEvent = require("./models/CRMBehavioralEvent");

async function calculateClientScores() {
  const now = new Date();
  const contacts = await CRMContact.find({});
  console.log(`Calculating scores for ${contacts.length} contacts...`);

  for (const contact of contacts) {
    try {
      const [comms, tasks, deals, events] = await Promise.all([
        CRMCommunication.find({
          $or: [
            { sender: contact.name },
            { receiver: contact.name },
            { sender: contact.email },
            { receiver: contact.email },
          ],
        }).sort({ date: -1 }).lean(),
        CRMTask.find({ linkedEntity: contact.name }).sort({ dueDate: -1 }).lean(),
        CRMDeal.find({ company: contact.company }).lean(),
        CRMBehavioralEvent.find({ contactId: contact._id }).sort({ timestamp: -1 }).lean(),
      ]);

      // Seed fallback correctly
      let lastInteraction = contact.lastInteractionDate || contact.createdAt || now;
      
      const latestComm = comms[0]?.date || comms[0]?.createdAt;
      const completedTasks = tasks.filter(t => t.status === "Completed");
      const latestTask = completedTasks[0]?.updatedAt || completedTasks[0]?.dueDate;

      if (latestComm || latestTask) {
        let absoluteLatest = null;
        if (latestComm) absoluteLatest = new Date(latestComm);
        if (latestTask) {
          const taskDate = new Date(latestTask);
          if (!absoluteLatest || taskDate > absoluteLatest) absoluteLatest = taskDate;
        }
        lastInteraction = absoluteLatest;
      }

      const daysSinceLastComm = Math.max(0, Math.floor((now - new Date(lastInteraction)) / (1000 * 60 * 60 * 24)));
      const accountValue = deals.reduce((sum, deal) => sum + (deal.value || 0), 0);
      const activeDeals = deals.filter(d => !["Closed Won", "Closed Lost"].includes(d.stage));

      let ccieScore = 100;
      ccieScore -= daysSinceLastComm * 2.5;
      ccieScore += events.length * 4;
      ccieScore += activeDeals.length * 5;
      ccieScore += Math.min(10, Math.floor(accountValue / 10000));
      ccieScore = Math.max(0, Math.min(100, Math.round(ccieScore)));

      let rgeScore = 0;
      rgeScore += Math.min(30, Math.floor(accountValue / 5000) * 5);
      rgeScore += events.length * 8;
      const hasActiveProposal = activeDeals.some(d => ["Proposal", "Negotiation"].includes(d.stage));
      if (hasActiveProposal) rgeScore += 30;
      if (daysSinceLastComm <= 7) rgeScore += 15;
      rgeScore = Math.max(0, Math.min(100, Math.round(rgeScore)));

      contact.continuityScore = ccieScore;
      contact.revenueGravityScore = rgeScore;
      contact.accountValue = accountValue;
      contact.lastInteractionDate = lastInteraction;
      await contact.save();
      
      console.log(`- ${contact.name}: CCIE = ${ccieScore}, RGE = ${rgeScore}, Value = $${accountValue}, Inactive Days = ${daysSinceLastComm}`);
    } catch (err) {
      console.error(`Error calculating scores for ${contact.name}:`, err);
    }
  }
}

async function main() {
  await connectDb();
  await calculateClientScores();
  console.log("Calculations complete!");
  process.exit(0);
}

main();
