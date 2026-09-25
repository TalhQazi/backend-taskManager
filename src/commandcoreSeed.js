require("dotenv").config();
const { connectDb } = require("./lib/db");
const CRMContact = require("./models/CRMContact");
const CRMDeal = require("./models/CRMDeal");
const CRMTask = require("./models/CRMTask");
const CRMCommunication = require("./models/CRMCommunication");
const CRMBehavioralEvent = require("./models/CRMBehavioralEvent");
const CRMAutomationRule = require("./models/CRMAutomationRule");

async function main() {
  await connectDb();
  console.log("Connected to database. Starting CommandCore seeding...");

  // 1. Clear existing CRM data to ensure clean state
  await Promise.all([
    CRMContact.deleteMany({}),
    CRMDeal.deleteMany({}),
    CRMTask.deleteMany({ title: /\[CCIE|CCIE Action|CCIE Escalation|VIP/ }),
    CRMCommunication.deleteMany({}),
    CRMBehavioralEvent.deleteMany({}),
    CRMAutomationRule.deleteMany({}),
  ]);
  console.log("Cleared existing telemetry, automation, and score data.");

  // 2. Create default Automation Rules
  const rules = [
    {
      name: "VIP Lead High Gravity Alert",
      trigger: "email_open",
      conditions: { tagPresence: "VIP" },
      actions: [
        {
          actionType: "create_task",
          params: {
            titleTemplate: "VIP Lead [ContactName] opened email - Immediate outreach required",
            priority: "High",
            assignedTo: "Account Representative",
          },
        },
        {
          actionType: "escalate",
          params: {},
        },
      ],
      isActive: true,
    },
    {
      name: "Proposal Engagement Intent Trigger",
      trigger: "proposal_view",
      conditions: {},
      actions: [
        {
          actionType: "send_email",
          params: {
            subject: "Answering your proposal questions",
            body: "Hi [ContactName],\n\nI noticed you recently reviewed our system proposal. I wanted to check in to see if you have any questions or if you would like to schedule a 10-minute session to go over the specifications?\n\nBest regards,\nCustomer Account Manager",
          },
        },
        {
          actionType: "create_task",
          params: {
            titleTemplate: "Follow up on proposal review for [ContactName]",
            priority: "Medium",
            assignedTo: "Account Representative",
          },
        },
      ],
      isActive: true,
    },
    {
      name: "Website Telemetry Activity Trigger",
      trigger: "site_visit",
      conditions: {},
      actions: [
        {
          actionType: "create_task",
          params: {
            titleTemplate: "Call [ContactName] - Repeated website visits detected",
            priority: "High",
            assignedTo: "Sales Representative",
          },
        },
      ],
      isActive: true,
    },
  ];

  await CRMAutomationRule.create(rules);
  console.log("Seeded default visual automation rules.");

  // 3. Create Contacts
  const contactsData = [
    {
      name: "Tony Stark",
      company: "Stark Industries",
      email: "tony@stark.com",
      phone: "+1 (555) 300-3000",
      status: "Active",
      tags: ["VIP", "High Growth"],
      relationshipType: "Client",
      address: "10880 Malibu Point, Malibu, CA",
      notes: "Extremely active lead. Highly interested in core tech expansions.",
      continuityScore: 85,
      revenueGravityScore: 92,
      accountValue: 85000,
      lastInteractionDate: new Date(),
    },
    {
      name: "Bruce Wayne",
      company: "Wayne Enterprises",
      email: "bruce@wayne.com",
      phone: "+1 (555) 999-9999",
      status: "Active",
      tags: ["VIP", "Enterprise"],
      relationshipType: "Client",
      address: "Wayne Manor, Gotham City",
      notes: "Onboarded client. Maintained stable contact streams.",
      continuityScore: 98,
      revenueGravityScore: 78,
      accountValue: 250000,
      lastInteractionDate: new Date(),
    },
    {
      name: "Peter Gibbons",
      company: "Initech",
      email: "peter@initech.com",
      phone: "+1 (555) 888-8888",
      status: "Active",
      tags: ["At Risk", "Standard"],
      relationshipType: "Client",
      address: "4120 Freemont Ave, Austin, TX",
      notes: "Inactivity detected. Health index dropping quickly. Needs follow-up.",
      continuityScore: 48,
      revenueGravityScore: 35,
      accountValue: 20000,
      lastInteractionDate: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000), // 35 days ago
    },
    {
      name: "John Doe",
      company: "Acme Corp",
      email: "john@acme.com",
      phone: "+1 (555) 123-4567",
      status: "Active",
      tags: ["Enterprise"],
      relationshipType: "Client",
      address: "123 Industrial Parkway, Chicago, IL",
      notes: "Core contract finalized. Excellent relationship health.",
      continuityScore: 92,
      revenueGravityScore: 50,
      accountValue: 120000,
      lastInteractionDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
    },
    {
      name: "Hank Scorpio",
      company: "Globex Corporation",
      email: "hank@globex.com",
      phone: "+1 (555) 444-4444",
      status: "Active",
      tags: ["New Lead"],
      relationshipType: "Lead",
      address: "Cypress Creek, OR",
      notes: "Registered via website form. Highly engaged initially.",
      continuityScore: 72,
      revenueGravityScore: 68,
      accountValue: 45000,
      lastInteractionDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    },
    {
      name: "Albert Wesker",
      company: "Umbrella Corporation",
      email: "albert@umbrella.com",
      phone: "+1 (555) 666-6666",
      status: "Inactive",
      tags: ["Critical", "At Risk"],
      relationshipType: "Client",
      address: "Raccoon City",
      notes: "Completely unresponsive. Escapes all communications attempts.",
      continuityScore: 22,
      revenueGravityScore: 10,
      accountValue: 0,
      lastInteractionDate: new Date(Date.now() - 95 * 24 * 60 * 60 * 1000), // 95 days ago
    },
  ];

  const contacts = await CRMContact.create(contactsData);
  console.log(`Seeded ${contacts.length} advanced contact cards.`);

  // Find seeded contact references
  const tony = contacts.find(c => c.name === "Tony Stark");
  const bruce = contacts.find(c => c.name === "Bruce Wayne");
  const peter = contacts.find(c => c.name === "Peter Gibbons");
  const john = contacts.find(c => c.name === "John Doe");
  const hank = contacts.find(c => c.name === "Hank Scorpio");
  const albert = contacts.find(c => c.name === "Albert Wesker");

  // 4. Create Deals
  const dealsData = [
    {
      name: "Arc Reactor Integration Project",
      company: "Stark Industries",
      value: 85000,
      stage: "Proposal",
      probability: 75,
      closeDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      owner: "Tony Stark",
    },
    {
      name: "Satellite Comms Array Upgrade",
      company: "Wayne Enterprises",
      value: 250000,
      stage: "Closed Won",
      probability: 100,
      closeDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      owner: "Bruce Wayne",
    },
    {
      name: "Y2K Compliance Consulting",
      company: "Initech",
      value: 20000,
      stage: "Closed Lost",
      probability: 0,
      closeDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
      owner: "Unassigned",
    },
    {
      name: "Acme Web Portal Contract",
      company: "Acme Corp",
      value: 120000,
      stage: "Closed Won",
      probability: 100,
      closeDate: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
      owner: "John Doe",
    },
    {
      name: "Globex Global Automation Deal",
      company: "Globex Corporation",
      value: 45000,
      stage: "Qualification",
      probability: 30,
      closeDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      owner: "Hank Scorpio",
    },
  ];

  await CRMDeal.create(dealsData);
  console.log("Seeded sample deals.");

  // 5. Create historical Behavioral Events
  const eventsData = [
    // Tony (high gravity)
    { contactId: tony._id, eventType: "site_visit", description: "Visited Pricing Page", timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000) },
    { contactId: tony._id, eventType: "site_visit", description: "Visited Documentation", timestamp: new Date(Date.now() - 4 * 60 * 60 * 1000) },
    { contactId: tony._id, eventType: "email_open", description: "Opened Proposal email", timestamp: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000) },
    { contactId: tony._id, eventType: "email_open", description: "Opened Product introduction email", timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) },
    { contactId: tony._id, eventType: "proposal_view", description: "Reviewed Contract Proposal", timestamp: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) },
    
    // Hank
    { contactId: hank._id, eventType: "site_visit", description: "Visited Homepage", timestamp: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) },
    { contactId: hank._id, eventType: "email_open", description: "Opened Welcome email", timestamp: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) },

    // John
    { contactId: john._id, eventType: "email_open", description: "Opened Monthly report email", timestamp: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000) },

    // Albert (dormant)
    { contactId: albert._id, eventType: "email_open", description: "Opened initial sales email", timestamp: new Date(Date.now() - 94 * 24 * 60 * 60 * 1000) },
  ];

  await CRMBehavioralEvent.create(eventsData);
  console.log("Seeded default telemetry behavioral events.");

  // 6. Create Historical Communications conforming to CRMCommunication model schema
  await CRMCommunication.create([
    {
      type: "Call",
      sender: "Sales Team",
      receiver: tony.name,
      content: "Had a great discussion regarding their custom deployment parameters.",
      status: "Logged",
      date: new Date(),
    },
    {
      type: "Call",
      sender: "Success Team",
      receiver: bruce.name,
      content: "Successfully onboarded Wayne Enterprises engineering leads.",
      status: "Logged",
      date: new Date(),
    },
    {
      type: "Email",
      sender: "Account Representative",
      receiver: peter.name,
      content: "Sent check-in email but received no response.",
      status: "Sent",
      date: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000),
    },
  ]);
  console.log("Seeded basic CRM communication timelines.");

  console.log("CommandCore seeding successfully completed.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed to seed CommandCore:", err);
  process.exit(1);
});
