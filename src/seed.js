const bcrypt = require("bcryptjs");
require("dotenv").config();

const { connectDb } = require("./lib/db");
const User = require("./models/User");

async function seedUser({ username, password, role }) {
  const existing = await User.findOne({ username }).lean();
  if (existing) return;

  const passwordHash = await bcrypt.hash(password, 10);
  await User.create({ username, passwordHash, role });
}

async function main() {
  await connectDb();

  await seedUser({ username: "admin", password: "admin123", role: "admin" });
  await seedUser({ username: "manager", password: "manager123", role: "manager" });
  await seedUser({ username: "developer", password: "developer123", role: "developer" });

  const Holiday = require("./models/Holiday");
  const initialHolidays = [
    {
      name: "lunar-new-year",
      displayName: "Lunar New Year",
      country_code: "CN",
      region: "Asia",
      religion_category: "cultural",
      is_lunar_calendar: true,
      localization_language_key: "lunar_new_year",
      significance_level: 4,
      themeConfig: {
        backgroundType: "color",
        colorConfig: { from: "#7A0000", via: "#A30000", to: "#D60000" },
        effects: "lanterns",
        overlay: { enabled: true, color: "rgba(0,0,0,0.3)" }
      }
    },
    {
      name: "diwali",
      displayName: "Diwali",
      country_code: "IN",
      region: "Asia",
      religion_category: "religious",
      is_lunar_calendar: true,
      localization_language_key: "diwali",
      significance_level: 4,
      themeConfig: {
        backgroundType: "color",
        colorConfig: { from: "#3F0071", via: "#610094", to: "#FFB319" },
        effects: "sparkles",
        overlay: { enabled: true, color: "rgba(0,0,0,0.2)" }
      }
    },
    {
      name: "eid-al-fitr",
      displayName: "Eid al-Fitr",
      country_code: "global",
      region: "Middle East",
      religion_category: "religious",
      is_lunar_calendar: true,
      localization_language_key: "eid_al_fitr",
      significance_level: 5,
      themeConfig: {
        backgroundType: "color",
        colorConfig: { from: "#0A4D2E", via: "#0F7D4B", to: "#FFD700" },
        effects: "stars",
        overlay: { enabled: true, color: "rgba(0,0,0,0.3)" }
      }
    },
    {
      name: "eid-al-adha",
      displayName: "Eid al-Adha",
      country_code: "global",
      region: "Middle East",
      religion_category: "religious",
      is_lunar_calendar: true,
      localization_language_key: "eid_al_adha",
      significance_level: 5,
      themeConfig: {
        backgroundType: "color",
        colorConfig: { from: "#053B50", via: "#176B87", to: "#64CCC5" },
        effects: "stars",
        overlay: { enabled: true, color: "rgba(0,0,0,0.3)" }
      }
    },
    {
      name: "hanukkah",
      displayName: "Hanukkah",
      country_code: "global",
      region: "Middle East",
      religion_category: "religious",
      is_lunar_calendar: true,
      localization_language_key: "hanukkah",
      significance_level: 4,
      themeConfig: {
        backgroundType: "color",
        colorConfig: { from: "#001F54", via: "#0A1128", to: "#00E8FC" },
        effects: "sparkles",
        overlay: { enabled: true, color: "rgba(0,0,0,0.3)" }
      }
    },
    {
      name: "ramadan",
      displayName: "Ramadan",
      country_code: "global",
      region: "Middle East",
      religion_category: "religious",
      is_lunar_calendar: true,
      localization_language_key: "ramadan",
      significance_level: 3,
      themeConfig: {
        backgroundType: "color",
        colorConfig: { from: "#0F0F1A", via: "#1F1F35", to: "#2E2A47" },
        effects: "stars",
        overlay: { enabled: true, color: "rgba(0,0,0,0.5)" }
      }
    },
    {
      name: "mid-autumn-festival",
      displayName: "Mid-Autumn Festival",
      country_code: "CN",
      region: "Asia",
      religion_category: "cultural",
      is_lunar_calendar: true,
      localization_language_key: "mid_autumn_festival",
      significance_level: 3,
      themeConfig: {
        backgroundType: "color",
        colorConfig: { from: "#141E30", via: "#243B55", to: "#F7BB97" },
        effects: "lanterns",
        overlay: { enabled: true, color: "rgba(0,0,0,0.3)" }
      }
    },
    {
      name: "golden-week",
      displayName: "Golden Week",
      country_code: "JP",
      region: "Asia",
      religion_category: "national",
      is_lunar_calendar: false,
      localization_language_key: "golden_week",
      significance_level: 3,
      static_start_date: "04-29",
      static_end_date: "05-05",
      themeConfig: {
        backgroundType: "color",
        colorConfig: { from: "#FF9999", via: "#FF5E62", to: "#FFD97D" },
        effects: "leaves",
        overlay: { enabled: true, color: "rgba(0,0,0,0.2)" }
      }
    },
    {
      name: "bastille-day",
      displayName: "Bastille Day",
      country_code: "FR",
      region: "Europe",
      religion_category: "national",
      is_lunar_calendar: false,
      localization_language_key: "bastille_day",
      significance_level: 4,
      static_start_date: "07-14",
      static_end_date: "07-14",
      themeConfig: {
        backgroundType: "color",
        colorConfig: { from: "#051A80", via: "#FFFFFF", to: "#D6001C" },
        effects: "confetti",
        overlay: { enabled: true, color: "rgba(0,0,0,0.2)" }
      }
    },
    {
      name: "oktoberfest",
      displayName: "Oktoberfest",
      country_code: "DE",
      region: "Europe",
      religion_category: "cultural",
      is_lunar_calendar: false,
      localization_language_key: "oktoberfest",
      significance_level: 3,
      static_start_date: "09-15",
      static_end_date: "10-05",
      themeConfig: {
        backgroundType: "color",
        colorConfig: { from: "#8D4E12", via: "#EBB02D", to: "#FFD97D" },
        effects: "leaves",
        overlay: { enabled: true, color: "rgba(0,0,0,0.3)" }
      }
    },
    {
      name: "canada-day",
      displayName: "Canada Day",
      country_code: "CA",
      region: "North America",
      religion_category: "national",
      is_lunar_calendar: false,
      localization_language_key: "canada_day",
      significance_level: 4,
      static_start_date: "07-01",
      static_end_date: "07-01",
      themeConfig: {
        backgroundType: "color",
        colorConfig: { from: "#A30000", via: "#FFFFFF", to: "#D60000" },
        effects: "confetti",
        overlay: { enabled: true, color: "rgba(0,0,0,0.2)" }
      }
    },
    {
      name: "australia-day",
      displayName: "Australia Day",
      country_code: "AU",
      region: "Global",
      religion_category: "national",
      is_lunar_calendar: false,
      localization_language_key: "australia_day",
      significance_level: 4,
      static_start_date: "01-26",
      static_end_date: "01-26",
      themeConfig: {
        backgroundType: "color",
        colorConfig: { from: "#0A1128", via: "#1C3144", to: "#D00000" },
        effects: "confetti",
        overlay: { enabled: true, color: "rgba(0,0,0,0.3)" }
      }
    }
  ];

  for (const h of initialHolidays) {
    const existingH = await Holiday.findOne({ name: h.name }).lean();
    if (!existingH) {
      await Holiday.create(h);
      console.log(`Seeded holiday: ${h.displayName}`);
    }
  }

  console.log("Seed complete");
  process.exit(0);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
