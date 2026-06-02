const Settings = require("../models/Settings");
const Employee = require("../models/Employee");
const Location = require("../models/Location");
const Holiday = require("../models/Holiday");
const SystemSettings = require("../models/SystemSettings");

// Dictionary of precise Lunar Holiday Dates (2024-2030)
// Format: { year: { holidayKey: { start: "MM-DD", end: "MM-DD" } } }
const lunarHolidayDates = {
  2024: {
    "lunar-new-year": { start: "02-10", end: "02-13" },
    "diwali": { start: "11-01", end: "11-02" },
    "eid-al-fitr": { start: "04-10", end: "04-11" },
    "eid-al-adha": { start: "06-16", end: "06-17" },
    "hanukkah": { start: "12-25", end: "12-31" },
    "ramadan": { start: "03-10", end: "04-09" },
    "mid-autumn-festival": { start: "09-17", end: "09-17" },
  },
  2025: {
    "lunar-new-year": { start: "01-29", end: "02-01" },
    "diwali": { start: "10-20", end: "10-21" },
    "eid-al-fitr": { start: "03-30", end: "03-31" },
    "eid-al-adha": { start: "06-06", end: "06-07" },
    "hanukkah": { start: "12-14", end: "12-22" },
    "ramadan": { start: "02-28", end: "03-29" },
    "mid-autumn-festival": { start: "10-06", end: "10-06" },
  },
  2026: {
    "lunar-new-year": { start: "02-17", end: "02-20" },
    "diwali": { start: "11-08", end: "11-09" },
    "eid-al-fitr": { start: "03-19", end: "03-20" },
    "eid-al-adha": { start: "05-26", end: "05-27" },
    "hanukkah": { start: "12-04", end: "12-12" },
    "ramadan": { start: "02-17", end: "03-18" },
    "mid-autumn-festival": { start: "09-25", end: "09-25" },
  },
  2027: {
    "lunar-new-year": { start: "02-06", end: "02-09" },
    "diwali": { start: "10-29", end: "10-30" },
    "eid-al-fitr": { start: "03-09", end: "03-10" },
    "eid-al-adha": { start: "05-16", end: "05-17" },
    "hanukkah": { start: "12-24", end: "12-31" },
    "ramadan": { start: "02-07", end: "03-08" },
    "mid-autumn-festival": { start: "09-15", end: "09-15" },
  },
  2028: {
    "lunar-new-year": { start: "01-26", end: "01-29" },
    "diwali": { start: "10-17", end: "10-18" },
    "eid-al-fitr": { start: "02-26", end: "02-27" },
    "eid-al-adha": { start: "05-04", end: "05-05" },
    "hanukkah": { start: "12-12", end: "12-20" },
    "ramadan": { start: "01-28", end: "02-26" },
    "mid-autumn-festival": { start: "10-03", end: "10-03" },
  },
  2029: {
    "lunar-new-year": { start: "02-13", end: "02-16" },
    "diwali": { start: "11-05", end: "11-06" },
    "eid-al-fitr": { start: "02-15", end: "02-16" },
    "eid-al-adha": { start: "04-24", end: "04-25" },
    "hanukkah": { start: "12-02", end: "12-10" },
    "ramadan": { start: "01-17", end: "02-15" },
    "mid-autumn-festival": { start: "09-22", end: "09-22" },
  },
  2030: {
    "lunar-new-year": { start: "02-03", end: "02-06" },
    "diwali": { start: "10-26", end: "10-27" },
    "eid-al-fitr": { start: "02-04", end: "02-05" },
    "eid-al-adha": { start: "04-13", end: "04-14" },
    "hanukkah": { start: "12-21", end: "12-29" },
    "ramadan": { start: "01-06", end: "02-04" },
    "mid-autumn-festival": { start: "09-12", end: "09-12" },
  },
};

// Simple astronomical estimate fallback for years outside 2024-2030
function getLunarEstimateFallback(name, year) {
  // Returns estimated offsets from a known anchor date
  // e.g. Lunar cycle averages 29.53059 days
  const anchorNewMoon = new Date("2024-01-11T11:57:00Z"); // Known standard new moon
  const msPerLunation = 29.53059 * 24 * 60 * 60 * 1000;

  // Let's approximate start dates for the year by adding offset averages
  let approximateStartMonth = 1;
  let approximateStartDay = 1;
  let durationDays = 1;

  if (name === "lunar-new-year") {
    // Chinese New Year falls on the new moon closest to the beginning of spring
    // roughly late Jan or early Feb
    approximateStartMonth = 2;
    approximateStartDay = Math.floor(5 + (year % 3) * 10);
    durationDays = 3;
  } else if (name === "diwali") {
    // Diwali is Kartika Amavasya, usually late Oct / early Nov
    approximateStartMonth = 10;
    approximateStartDay = Math.floor(15 + (year % 5) * 4);
    durationDays = 2;
  } else if (name === "eid-al-fitr") {
    approximateStartMonth = 3;
    approximateStartDay = Math.floor(10 + (year % 7) * 3);
    durationDays = 2;
  } else if (name === "eid-al-adha") {
    approximateStartMonth = 5;
    approximateStartDay = Math.floor(20 - (year % 4) * 5);
    durationDays = 2;
  } else if (name === "hanukkah") {
    approximateStartMonth = 12;
    approximateStartDay = Math.floor(10 + (year % 6) * 3);
    durationDays = 8;
  } else if (name === "ramadan") {
    approximateStartMonth = 2;
    approximateStartDay = Math.floor(25 - (year % 7) * 3);
    durationDays = 30;
  } else if (name === "mid-autumn-festival") {
    approximateStartMonth = 9;
    approximateStartDay = Math.floor(15 + (year % 4) * 3);
    durationDays = 1;
  }

  const start = new Date(year, approximateStartMonth - 1, approximateStartDay);
  const end = new Date(start.getTime() + durationDays * 24 * 60 * 60 * 1000);
  return { start, end };
}

// Get the actual active range of a holiday for a specific year
function getHolidayDateRange(holiday, year) {
  if (holiday.is_lunar_calendar) {
    const dates = lunarHolidayDates[year]?.[holiday.name];
    if (dates) {
      const [startM, startD] = dates.start.split("-").map(Number);
      const [endM, endD] = dates.end.split("-").map(Number);
      
      const start = new Date(year, startM - 1, startD, 0, 0, 0, 0);
      let end = new Date(year, endM - 1, endD, 23, 59, 59, 999);
      
      // If end date is chronologically before start (e.g. Hanukkah spanning Dec to Jan)
      if (end < start) {
        end = new Date(year + 1, endM - 1, endD, 23, 59, 59, 999);
      }
      return { start, end };
    } else {
      // Fallback
      return getLunarEstimateFallback(holiday.name, year);
    }
  } else {
    // Static Solar Holiday
    if (!holiday.static_start_date || !holiday.static_end_date) {
      return { start: new Date(0), end: new Date(0) };
    }
    const [startM, startD] = holiday.static_start_date.split("-").map(Number);
    const [endM, endD] = holiday.static_end_date.split("-").map(Number);

    const start = new Date(year, startM - 1, startD, 0, 0, 0, 0);
    let end = new Date(year, endM - 1, endD, 23, 59, 59, 999);

    if (end < start) {
      end = new Date(year + 1, endM - 1, endD, 23, 59, 59, 999);
    }
    return { start, end };
  }
}

// 4-Tier Localization Hierarchy Resolver
async function resolveUserCountryCode(userId, employee) {
  // Tier 1: User Profile Settings Country
  const settings = await Settings.findOne({ userId }).lean();
  if (settings && settings.countryCode && String(settings.countryCode).trim()) {
    return String(settings.countryCode).trim().toUpperCase();
  }

  // Tier 2: User Time Zone mapping
  const tz = (settings && settings.timezone) || "UTC";
  const tzLower = tz.toLowerCase();
  
  if (tzLower.includes("kolkata") || tzLower.includes("calcutta") || tzLower.includes("india")) return "IN";
  if (tzLower.includes("shanghai") || tzLower.includes("beijing") || tzLower.includes("china")) return "CN";
  if (tzLower.includes("tokyo") || tzLower.includes("japan")) return "JP";
  if (tzLower.includes("paris") || tzLower.includes("france")) return "FR";
  if (tzLower.includes("berlin") || tzLower.includes("germany")) return "DE";
  if (tzLower.includes("sydney") || tzLower.includes("melbourne") || tzLower.includes("brisbane") || tzLower.includes("australia")) return "AU";
  if (tzLower.includes("toronto") || tzLower.includes("vancouver") || tzLower.includes("montreal") || tzLower.includes("canada")) return "CA";
  if (tzLower.includes("london") || tzLower.includes("europe/london")) return "GB";

  // Tier 3: Office Location Assignment
  let empDoc = employee;
  if (!empDoc && userId) {
    empDoc = await Employee.findById(userId).lean();
    if (!empDoc) {
      // Fallback: search by name/email if userId is a general User._id
      const user = await require("../models/User").findById(userId).lean();
      if (user) {
        empDoc = await Employee.findOne({ $or: [{ email: user.email }, { name: user.name }] }).lean();
      }
    }
  }

  if (empDoc && empDoc.location) {
    const loc = await Location.findOne({ name: new RegExp(`^${escapeRegExp(empDoc.location)}$`, "i") }).lean();
    if (loc && loc.country && String(loc.country).trim()) {
      const countryStr = String(loc.country).trim().toLowerCase();
      if (countryStr === "india") return "IN";
      if (countryStr === "china") return "CN";
      if (countryStr === "japan") return "JP";
      if (countryStr === "france") return "FR";
      if (countryStr === "germany") return "DE";
      if (countryStr === "canada") return "CA";
      if (countryStr === "australia") return "AU";
      if (countryStr === "united states" || countryStr === "us" || countryStr === "usa") return "US";
    }
    
    // Check if the location string itself is a country
    const locLower = String(empDoc.location).trim().toLowerCase();
    if (locLower === "india") return "IN";
    if (locLower === "china") return "CN";
    if (locLower === "japan") return "JP";
    if (locLower === "france") return "FR";
    if (locLower === "germany") return "DE";
    if (locLower === "canada") return "CA";
    if (locLower === "australia") return "AU";
  }

  // Tier 4: Global Default Fallback
  return "US";
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Localization Messages Dictionary
const translations = {
  // Encouragement "You Rock" phrases translated per locale/language
  encouragement: {
    en: "You Rock!",
    fr: "Vous assurez !",
    de: "Du bist spitze!",
    es: "¡Eres genial!",
    zh: "你真棒！",
    jp: "君は最高だ！",
  },
  
  // Specific holiday localized titles & messages
  holidays: {
    "lunar-new-year": {
      title: {
        en: "Happy Lunar New Year!",
        zh: "新年快乐，万事如意！",
        fr: "Joyeux Nouvel An Lunaire !",
        de: "Frohes Mondneujahr!",
        es: "¡Feliz Año Nuevo Lunar!",
        jp: "春節おめでとうございます！",
      },
      message: {
        en: "Wishing you good fortune, wealth, and abundant happiness. {encouragement}",
        zh: "恭喜发财，万事如意！步步高升，身体健康！ {encouragement}",
        fr: "En vous souhaitant bonheur, prospérité et bonne fortune. {encouragement}",
        de: "Wir wünschen Ihnen viel Glück, Wohlstand und Erfolg im neuen Jahr. {encouragement}",
        es: "Te deseamos buena fortuna, riqueza y abundante felicidad. {encouragement}",
        jp: "新年にあたり、ご多幸とご健勝をお祈り申し上げます。 {encouragement}",
      }
    },
    "diwali": {
      title: {
        en: "Happy Diwali!",
        zh: "排灯节快乐！",
        fr: "Joyeux Diwali !",
        de: "Frohes Diwali!",
        es: "¡Feliz Diwali!",
        jp: "ディーワーリーおめでとう！",
      },
      message: {
        en: "May the festival of lights bring you joy, peace, and prosperity. {encouragement}",
        zh: "愿光明的节日给您带来欢乐、和平与繁荣。 {encouragement}",
        fr: "Que la fête des lumières vous apporte joie, paix et prospérité. {encouragement}",
        de: "Möge das Lichterfest Ihnen Freude, Frieden und Wohlstand schenken. {encouragement}",
        es: "Que el festival de las luces te traiga alegría, paz y prosperidad. {encouragement}",
        jp: "光のフェスティバルがあなたに喜び、平和、繁栄をもたらしますように。 {encouragement}",
      }
    },
    "eid-al-fitr": {
      title: {
        en: "Eid Mubarak!",
        zh: "开斋节快乐！",
        fr: "Eid Mubarak !",
        de: "Eid Mubarak!",
        es: "¡Eid Mubarak!",
        jp: "イード・ムバラク！",
      },
      message: {
        en: "Wishing you and your family a blessed Eid filled with harmony. {encouragement}",
        zh: "祝您和您的家人节日快乐，阖家幸福。 {encouragement}",
        fr: "En vous souhaitant, à vous et à votre famille, un Eid béni et harmonieux. {encouragement}",
        de: "Wir wünschen Ihnen und Ihrer Familie ein gesegnetes Eid voller Harmonie. {encouragement}",
        es: "Te deseamos a ti y a tu familia un bendecido Eid lleno de armonía. {encouragement}",
        jp: "あなたとご家族に調和に満ちた恵み豊かなイードを。 {encouragement}",
      }
    },
    "eid-al-adha": {
      title: {
        en: "Eid Mubarak!",
        zh: "宰牲节快乐！",
        fr: "Eid Mubarak !",
        de: "Eid Mubarak!",
        es: "¡Eid Mubarak!",
        jp: "イード・ムバラク！",
      },
      message: {
        en: "Wishing you peace, happiness, and prosperity on this Eid al-Adha. {encouragement}",
        zh: "在这个宰牲节，祝您和平、幸福与繁荣。 {encouragement}",
        fr: "En vous souhaitant paix, bonheur et prospérité à l'occasion de l'Eid al-Adha. {encouragement}",
        de: "Wir wünschen Ihnen Frieden, Glück und Wohlstand an diesem Opferfest. {encouragement}",
        es: "Te deseamos paz, felicidad y prosperidad en este Eid al-Adha. {encouragement}",
        jp: "このイード・アル＝アドハーに平和と幸福、繁栄をお祈りします。 {encouragement}",
      }
    },
    "hanukkah": {
      title: {
        en: "Happy Hanukkah!",
        zh: "光明节快乐！",
        fr: "Joyeux Hanoucca !",
        de: "Frohes Chanukka!",
        es: "¡Feliz Janucá!",
        jp: "ハヌカおめでとう！",
      },
      message: {
        en: "May your home be filled with light, laughter, and miracles. {encouragement}",
        zh: "愿您的家中充满光明、欢笑与奇迹。 {encouragement}",
        fr: "Que votre maison soit remplie de lumière, de rires et de miracles. {encouragement}",
        de: "Möge Ihr Heim mit Licht, Lachen und Wundern erfüllt sein. {encouragement}",
        es: "Que tu hogar esté lleno de luz, risas y milagros. {encouragement}",
        jp: "あなたのご家庭が光と笑い、そして奇跡で満たされますように。 {encouragement}",
      }
    },
    "ramadan": {
      title: {
        en: "Ramadan Kareem",
        zh: "斋月吉祥",
        fr: "Ramadan Kareem",
        de: "Ramadan Kareem",
        es: "Ramadán Kareem",
        jp: "ラマダン・カリーム",
      },
      message: {
        en: "Wishing you a peaceful and reflective Ramadan. {encouragement}",
        zh: "祝您度过一个和平与深思的斋月。 {encouragement}",
        fr: "En vous souhaitant un Ramadan paisible et propice à la réflexion. {encouragement}",
        de: "Wir wünschen Ihnen einen friedlichen und besinnlichen Ramadan. {encouragement}",
        es: "Te deseamos un Ramadán pacífico y de reflexión. {encouragement}",
        jp: "平和で思索に満ちたラマダンをお祈りします。 {encouragement}",
      }
    },
    "mid-autumn-festival": {
      title: {
        en: "Happy Mid-Autumn Festival!",
        zh: "中秋佳节快乐！",
        fr: "Joyeuse Fête de la Mi-Automne !",
        de: "Frohes Mondfest!",
        es: "¡Feliz Festival del Medio Otoño!",
        jp: "中秋の名月おめでとう！",
      },
      message: {
        en: "Wishing you a warm reunion under the beautiful full moon. {encouragement}",
        zh: "愿花好月圆人团圆，中秋快乐，幸福安康！ {encouragement}",
        fr: "En vous souhaitant de chaleureuses retrouvailles sous la pleine lune. {encouragement}",
        de: "Wir wünschen Ihnen ein herzliches Wiedersehen unter dem vollen Mond. {encouragement}",
        es: "Te deseamos un cálido reencuentro bajo la hermosa luna llena. {encouragement}",
        jp: "美しい満月の下での温かい再会をお祈り申し上げます。 {encouragement}",
      }
    },
    "golden-week": {
      title: {
        en: "Happy Golden Week!",
        jp: "ゴールデンウィークを楽しんで！",
        fr: "Bonne Semaine d'Or !",
        de: "Schöne Goldene Woche!",
      },
      message: {
        en: "Hope you have an amazing holiday and time to recharge. {encouragement}",
        jp: "素晴らしいお休みを過ごし、しっかりリフレッシュしてください！ {encouragement}",
        fr: "Passez de superbes vacances et prenez le temps de vous ressourcer. {encouragement}",
        de: "Genießen Sie die Feiertage und tanken Sie neue Kraft! {encouragement}",
      }
    },
    "bastille-day": {
      title: {
        en: "Happy Bastille Day!",
        fr: "Bonne Fête Nationale !",
        de: "Froher Nationalfeiertag!",
      },
      message: {
        en: "Celebrating liberty, equality, and fraternity together! {encouragement}",
        fr: "Célébrons ensemble la liberté, l'égalité et la fraternité ! {encouragement}",
        de: "Wir feiern heute gemeinsam Freiheit, Gleichheit und Brüderlichkeit! {encouragement}",
      }
    },
    "oktoberfest": {
      title: {
        en: "Happy Oktoberfest!",
        de: "O'zapft is! Frohe Wiesn!",
        fr: "Joyeuse Oktoberfest !",
      },
      message: {
        en: "Cheers to good food, good music, and rich cultural traditions! {encouragement}",
        de: "Prost! Auf gute Laune, traditionelle Musik und bayerische Geselligkeit! {encouragement}",
        fr: "Santé ! Célébrons la musique, la gastronomie et les riches traditions culturelles ! {encouragement}",
      }
    },
    "canada-day": {
      title: {
        en: "Happy Canada Day!",
        fr: "Bonne Fête du Canada !",
      },
      message: {
        en: "Happy birthday, Canada! Celebrating our diverse and beautiful nation. {encouragement}",
        fr: "Bonne fête, Canada ! Célébrons notre nation diverse et magnifique. {encouragement}",
      }
    },
    "australia-day": {
      title: {
        en: "Happy Australia Day!",
      },
      message: {
        en: "Celebrating everything we love about Australia and our community! {encouragement}",
      }
    }
  }
};

// Main Resolver: Resolves what holiday matches the user at this exact time, respecting hierarchy, sensitivity config, and overlaps
async function getResolvedHolidayTheme(userId) {
  try {
    const sysSettings = await SystemSettings.findOne({ key: "global" }).lean();
    const scheConfig = sysSettings?.scheConfig || {
      enableReligiousHolidays: true,
      switchNeutralSeasonal: false,
      forceCompanyUnifiedTheme: "",
    };

    // Admin Override Tier 1: Force company-wide unified theme
    if (scheConfig.forceCompanyUnifiedTheme) {
      const forcedH = await Holiday.findOne({ name: scheConfig.forceCompanyUnifiedTheme, is_active: true }).lean();
      if (forcedH) {
        return await compileThemeObject(forcedH, userId);
      }
    }

    // Resolve user profile properties
    const userCountry = await resolveUserCountryCode(userId);
    const settings = await Settings.findOne({ userId }).lean();
    const userLang = settings?.language || "en";

    // Fetch active holidays from database
    const holidays = await Holiday.find({ is_active: true }).lean();
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();

    const candidateMatches = [];

    for (const h of holidays) {
      // Sensitivity filters
      if (h.religion_category === "religious" && !scheConfig.enableReligiousHolidays) {
        continue; // Religious holidays disabled by admin
      }

      // Calculate start/end date ranges
      const { start, end } = getHolidayDateRange(h, currentYear);

      // Check date range overlap
      if (currentDate >= start && currentDate <= end) {
        // Validate user localization matching criteria
        const isGlobal = h.country_code === "global" || !h.country_code;
        const isUserCountryMatch = h.country_code && h.country_code.toUpperCase() === userCountry;

        if (isUserCountryMatch || isGlobal) {
          candidateMatches.push({
            holiday: h,
            isExactCountryMatch: isUserCountryMatch,
            weight: isUserCountryMatch ? 10 : 1, // Prioritize Region/Country match
          });
        }
      }
    }

    if (candidateMatches.length === 0) {
      // Fallback: If "neutral seasonal" mode is active, or if user is in winter/summer, we can render a gorgeous seasonal default!
      if (scheConfig.switchNeutralSeasonal) {
        return getNeutralSeasonalTheme(currentDate, userCountry, userLang);
      }
      return { active: false };
    }

    // Performance and Conflict Handling prioritizing based on:
    // 1. Region Match
    // 2. Cultural Significance Level
    // 3. Company Override Priority
    candidateMatches.sort((a, b) => {
      // 1. Region / Country match weight
      if (b.weight !== a.weight) {
        return b.weight - a.weight;
      }
      // 2. Significance level
      const sigA = a.holiday.significance_level || 1;
      const sigB = b.holiday.significance_level || 1;
      if (sigB !== sigA) {
        return sigB - sigA;
      }
      // 3. Fallback database order
      return 0;
    });

    const chosenMatch = candidateMatches[0].holiday;

    // Switch to neutral seasonal theme if admin enabled neutral seasonal overrides for holiday themes
    if (scheConfig.switchNeutralSeasonal && chosenMatch.religion_category === "religious") {
      return getNeutralSeasonalTheme(currentDate, userCountry, userLang);
    }

    return await compileThemeObject(chosenMatch, userId, userLang);
  } catch (error) {
    console.error("[SCHE Engine] Error resolving holiday theme:", error);
    return { active: false };
  }
}

// Compile Mongoose model theme config + translated phrases into a client-ready theme object
async function compileThemeObject(holiday, userId, lang = "en") {
  const settings = await Settings.findOne({ userId }).lean();
  const employee = await Employee.findOne({ userId }).lean();
  const targetLang = lang || settings?.language || "en";

  // Resolve translations
  const holTranslations = translations.holidays[holiday.name] || {};
  
  const localizedTitle = holTranslations.title?.[targetLang] || holTranslations.title?.["en"] || holiday.displayName;
  
  const rawMsg = holTranslations.message?.[targetLang] || holTranslations.message?.["en"] || `Happy ${holiday.displayName}!`;
  const encouragement = translations.encouragement[targetLang] || translations.encouragement["en"] || "You Rock!";
  
  const localizedMessage = rawMsg.replace("{encouragement}", encouragement);

  return {
    active: true,
    name: holiday.name,
    displayName: localizedTitle,
    message: localizedMessage,
    backgroundType: holiday.themeConfig.backgroundType,
    colorConfig: holiday.themeConfig.colorConfig,
    imageConfig: holiday.themeConfig.imageConfig,
    overlay: holiday.themeConfig.overlay,
    effects: holiday.themeConfig.effects,
    isLunar: holiday.is_lunar_calendar,
    religionCategory: holiday.religion_category,
  };
}

// Generate Neutral seasonal theme (Spring, Summer, Autumn, Winter) for neutral configurations
function getNeutralSeasonalTheme(date, countryCode, lang = "en") {
  const month = date.getMonth(); // 0-11
  let season = "spring";
  
  // Determine season based on hemisphere
  const isSouthernHemisphere = ["AU", "ZA", "BR", "AR", "CL"].includes(countryCode);

  if (isSouthernHemisphere) {
    if (month >= 11 || month <= 1) season = "summer";
    else if (month >= 2 && month <= 4) season = "autumn";
    else if (month >= 5 && month <= 7) season = "winter";
    else season = "spring";
  } else {
    if (month >= 11 || month <= 1) season = "winter";
    else if (month >= 2 && month <= 4) season = "spring";
    else if (month >= 5 && month <= 7) season = "summer";
    else season = "autumn";
  }

  const encouragement = translations.encouragement[lang] || translations.encouragement["en"] || "You Rock!";

  const seasonalThemes = {
    spring: {
      displayName: lang === "zh" ? "春天快乐！" : lang === "fr" ? "Joyeux Printemps !" : "Happy Spring!",
      message: lang === "zh" ? `愿您的每一天都充满生机与希望！ ${encouragement}` : `Wishing you a fresh, energetic spring! ${encouragement}`,
      backgroundType: "color",
      colorConfig: { from: "#3A6073", via: "#3A6073", to: "#16A085" },
      effects: "sparkles", // fresh sparkles
    },
    summer: {
      displayName: lang === "zh" ? "清爽夏日！" : lang === "fr" ? "Bel Été !" : "Happy Summer!",
      message: lang === "zh" ? `保持清凉，工作顺利！ ${encouragement}` : `Wishing you bright, productive sunny days! ${encouragement}`,
      backgroundType: "color",
      colorConfig: { from: "#F3904F", via: "#3B4371", to: "#3B4371" },
      effects: "sparkles", // summer sun rays
    },
    autumn: {
      displayName: lang === "zh" ? "金色秋天！" : lang === "fr" ? "Joyeux Automne !" : "Happy Autumn!",
      message: lang === "zh" ? `收获的季节，祝您工作成果累累！ ${encouragement}` : `Wishing you a beautiful golden season of harvest. ${encouragement}`,
      backgroundType: "color",
      colorConfig: { from: "#E29587", via: "#D66060", to: "#D66060" },
      effects: "leaves", // falling leaves
    },
    winter: {
      displayName: lang === "zh" ? "温暖冬季！" : lang === "fr" ? "Joyeux Hiver !" : "Happy Winter!",
      message: lang === "zh" ? `注意保暖，祝您度过温馨的冬季。 ${encouragement}` : `Wishing you a cozy, warm winter season. ${encouragement}`,
      backgroundType: "color",
      colorConfig: { from: "#29323C", via: "#29323C", to: "#485563" },
      effects: "snow", // falling snow
    }
  };

  const chosenTheme = seasonalThemes[season];

  return {
    active: true,
    name: `neutral-${season}`,
    displayName: chosenTheme.displayName,
    message: chosenTheme.message,
    backgroundType: chosenTheme.backgroundType,
    colorConfig: chosenTheme.colorConfig,
    imageConfig: { url: "", size: "cover", position: "center", repeat: "no-repeat" },
    overlay: { enabled: true, color: "rgba(0,0,0,0.2)" },
    effects: chosenTheme.effects,
    isLunar: false,
    religionCategory: "neutral",
  };
}

module.exports = {
  getResolvedHolidayTheme,
  resolveUserCountryCode,
  getHolidayDateRange,
};
