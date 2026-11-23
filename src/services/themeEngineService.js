const HolidayTheme = require("../models/HolidayTheme");
const ThemeAsset = require("../models/ThemeAsset");
const ThemeSchedule = require("../models/ThemeSchedule");
const OrgThemeSettings = require("../models/OrgThemeSettings");
const UserThemePreferences = require("../models/UserThemePreferences");
const ThemeAuditLog = require("../models/ThemeAuditLog");

// --- Procedural SVG Assets for High-Performance Out-Of-The-Box Rendering ---
const HALLOWEEN_ASSETS = {
  background: {
    desktop: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080"><defs><radialGradient id="moon" cx="80%" cy="20%" r="35%"><stop offset="0%" stop-color="%23ffeedd" stop-opacity="0.35"/><stop offset="50%" stop-color="%237b2cff" stop-opacity="0.15"/><stop offset="100%" stop-color="%230b0713" stop-opacity="0"/></radialGradient><linearGradient id="bgGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="%23120b22"/><stop offset="50%" stop-color="%230c0717"/><stop offset="100%" stop-color="%2305030a"/></linearGradient></defs><rect width="1920" height="1080" fill="url(%23bgGrad)"/><rect width="1920" height="1080" fill="url(%23moon)"/><circle cx="1500" cy="200" r="110" fill="%23fff2cc" opacity="0.18"/><circle cx="1470" cy="180" r="100" fill="%230c0717" opacity="0.85"/><path d="M0,1080 Q480,950 960,1020 T1920,980 L1920,1080 Z" fill="%231a0b2e" opacity="0.45"/></svg>`,
    tablet: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="768" viewBox="0 0 1024 768"><defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="%23120b22"/><stop offset="100%" stop-color="%2305030a"/></linearGradient></defs><rect width="1024" height="768" fill="url(%23bg)"/><circle cx="850" cy="140" r="70" fill="%23fff2cc" opacity="0.16"/></svg>`,
    mobile: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="480" height="854" viewBox="0 0 480 854"><rect width="480" height="854" fill="%230b0713"/></svg>`,
  },
  headerBanner: {
    desktop: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="128" viewBox="0 0 1920 128"><defs><linearGradient id="glow" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="%23ff7a1a" stop-opacity="0.25"/><stop offset="50%" stop-color="%237b2cff" stop-opacity="0.35"/><stop offset="100%" stop-color="%23ff7a1a" stop-opacity="0.25"/></linearGradient></defs><rect width="1920" height="128" fill="url(%23glow)"/><path d="M0,126 Q480,118 960,126 T1920,124" stroke="%23ff7a1a" stroke-width="2" fill="none" opacity="0.75"/><g fill="%23ff7a1a" opacity="0.65"><path d="M120,40 Q135,25 150,40 Q165,25 180,40 Q150,65 120,40 Z"/><path d="M1800,45 Q1815,30 1830,45 Q1845,30 1860,45 Q1830,70 1800,45 Z"/></g></svg>`,
    tablet: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="96" viewBox="0 0 1024 96"><rect width="1024" height="96" fill="%231a0e2e" opacity="0.5"/><line x1="0" y1="95" x2="1024" y2="95" stroke="%23ff7a1a" stroke-width="1.5" opacity="0.6"/></svg>`,
    mobile: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="480" height="64" viewBox="0 0 480 64"><rect width="480" height="64" fill="%23120824" opacity="0.6"/><line x1="0" y1="63" x2="480" y2="63" stroke="%23ff7a1a" stroke-width="1" opacity="0.5"/></svg>`,
  },
  sideFrameLeft: {
    desktop: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="56" height="1080" viewBox="0 0 56 1080"><defs><linearGradient id="fadeL" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="%23ff7a1a" stop-opacity="0.22"/><stop offset="70%" stop-color="%237b2cff" stop-opacity="0.10"/><stop offset="100%" stop-color="%237b2cff" stop-opacity="0"/></linearGradient></defs><rect width="56" height="1080" fill="url(%23fadeL)"/><line x1="55" y1="0" x2="55" y2="1080" stroke="%237b2cff" stroke-width="1" stroke-dasharray="8,6" opacity="0.4"/><g stroke="%23ff7a1a" stroke-width="1.2" fill="none" opacity="0.45"><path d="M0,80 Q25,90 35,120 Q15,150 0,160"/><path d="M0,450 Q28,470 38,510 Q12,540 0,560"/><path d="M0,850 Q30,880 40,920 Q15,950 0,970"/></g></svg>`,
    tablet: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="28" height="768" viewBox="0 0 28 768"><rect width="28" height="768" fill="%237b2cff" opacity="0.08"/></svg>`,
    mobile: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="8" height="854" viewBox="0 0 8 854"><rect width="8" height="854" fill="%23ff7a1a" opacity="0.1"/></svg>`,
  },
  sideFrameRight: {
    desktop: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="56" height="1080" viewBox="0 0 56 1080"><defs><linearGradient id="fadeR" x1="1" y1="0" x2="0" y2="0"><stop offset="0%" stop-color="%23ff7a1a" stop-opacity="0.22"/><stop offset="70%" stop-color="%237b2cff" stop-opacity="0.10"/><stop offset="100%" stop-color="%237b2cff" stop-opacity="0"/></linearGradient></defs><rect width="56" height="1080" fill="url(%23fadeR)"/><line x1="1" y1="0" x2="1" y2="1080" stroke="%237b2cff" stroke-width="1" stroke-dasharray="8,6" opacity="0.4"/><g stroke="%23ff7a1a" stroke-width="1.2" fill="none" opacity="0.45"><path d="M56,100 Q31,110 21,140 Q41,170 56,180"/><path d="M56,500 Q26,520 16,560 Q42,590 56,610"/></g></svg>`,
    tablet: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="28" height="768" viewBox="0 0 28 768"><rect width="28" height="768" fill="%237b2cff" opacity="0.08"/></svg>`,
    mobile: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="8" height="854" viewBox="0 0 8 854"><rect width="8" height="854" fill="%23ff7a1a" opacity="0.1"/></svg>`,
  },
  bottomForeground: {
    desktop: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="140" viewBox="0 0 1920 140"><defs><linearGradient id="fogG" x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stop-color="%230b0713" stop-opacity="0.95"/><stop offset="40%" stop-color="%231c0d33" stop-opacity="0.65"/><stop offset="100%" stop-color="%237b2cff" stop-opacity="0"/></linearGradient></defs><rect width="1920" height="140" fill="url(%23fogG)"/><g transform="translate(120, 50)" fill="%23ff7a1a" opacity="0.8"><ellipse cx="40" cy="45" rx="35" ry="30"/><polygon points="32,38 38,38 35,32" fill="%231a0a00"/><polygon points="44,38 50,38 47,32" fill="%231a0a00"/><path d="M30,52 Q40,62 52,52 Z" fill="%231a0a00"/></g><g transform="translate(1720, 55)" fill="%23ff7a1a" opacity="0.8"><ellipse cx="35" cy="40" rx="30" ry="25"/><polygon points="28,34 33,34 30,29" fill="%231a0a00"/><polygon points="38,34 43,34 40,29" fill="%231a0a00"/><path d="M26,45 Q35,54 45,45 Z" fill="%231a0a00"/></g></svg>`,
    tablet: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="90" viewBox="0 0 1024 90"><rect width="1024" height="90" fill="%230b0713" opacity="0.7"/></svg>`,
    mobile: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="480" height="60" viewBox="0 0 480 60"><rect width="480" height="60" fill="%230b0713" opacity="0.8"/></svg>`,
  },
  transientOverlay: {
    desktop: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><path d="M80,20 C50,20 40,50 40,90 C40,120 55,140 65,130 C75,120 85,135 95,125 C105,115 120,130 120,90 C120,50 110,20 80,20 Z" fill="%23ffffff" opacity="0.55" filter="blur(2px)"/><circle cx="65" cy="65" r="7" fill="%23120b22"/><circle cx="95" cy="65" r="7" fill="%23120b22"/><ellipse cx="80" cy="90" rx="9" ry="14" fill="%23120b22"/></svg>`,
    tablet: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120"><circle cx="60" cy="60" r="50" fill="%23ffffff" opacity="0.45"/></svg>`,
    mobile: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80"><circle cx="40" cy="40" r="30" fill="%23ffffff" opacity="0.4"/></svg>`,
  },
};

const PATRIOTIC_ASSETS = {
  background: {
    desktop: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080"><defs><radialGradient id="patG1" cx="20%" cy="25%" r="40%"><stop offset="0%" stop-color="%23dc2626" stop-opacity="0.22"/><stop offset="100%" stop-color="%23070b19" stop-opacity="0"/></radialGradient><radialGradient id="patG2" cx="80%" cy="30%" r="40%"><stop offset="0%" stop-color="%232563eb" stop-opacity="0.25"/><stop offset="100%" stop-color="%23070b19" stop-opacity="0"/></radialGradient><linearGradient id="patBg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="%230b1329"/><stop offset="50%" stop-color="%23070b19"/><stop offset="100%" stop-color="%2304060d"/></linearGradient></defs><rect width="1920" height="1080" fill="url(%23patBg)"/><rect width="1920" height="1080" fill="url(%23patG1)"/><rect width="1920" height="1080" fill="url(%23patG2)"/><g fill="%23ffffff" opacity="0.25"><circle cx="200" cy="150" r="2.5"/><circle cx="500" cy="90" r="1.5"/><circle cx="850" cy="220" r="2"/><circle cx="1200" cy="110" r="2.5"/><circle cx="1600" cy="180" r="2"/></g></svg>`,
    tablet: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="768" viewBox="0 0 1024 768"><rect width="1024" height="768" fill="%23070b19"/></svg>`,
    mobile: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="480" height="854" viewBox="0 0 480 854"><rect width="480" height="854" fill="%23070b19"/></svg>`,
  },
  headerBanner: {
    desktop: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="120" viewBox="0 0 1920 120"><defs><linearGradient id="usGrad" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="%23dc2626" stop-opacity="0.3"/><stop offset="35%" stop-color="%23ffffff" stop-opacity="0.1"/><stop offset="70%" stop-color="%232563eb" stop-opacity="0.35"/><stop offset="100%" stop-color="%23dc2626" stop-opacity="0.25"/></linearGradient></defs><rect width="1920" height="120" fill="url(%23usGrad)"/><line x1="0" y1="118" x2="1920" y2="118" stroke="%2338bdf8" stroke-width="2" opacity="0.7"/><g fill="%23fbbf24" opacity="0.7" transform="translate(160, 45)"><polygon points="12,0 15,8 24,8 17,14 20,22 12,17 4,22 7,14 0,8 9,8"/></g><g fill="%23fbbf24" opacity="0.7" transform="translate(1740, 45)"><polygon points="12,0 15,8 24,8 17,14 20,22 12,17 4,22 7,14 0,8 9,8"/></g></svg>`,
    tablet: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="96" viewBox="0 0 1024 96"><rect width="1024" height="96" fill="%230f1d40" opacity="0.5"/><line x1="0" y1="95" x2="1024" y2="95" stroke="%23dc2626" stroke-width="1.5"/></svg>`,
    mobile: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="480" height="64" viewBox="0 0 480 64"><rect width="480" height="64" fill="%230b1329" opacity="0.6"/></svg>`,
  },
  sideFrameLeft: {
    desktop: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="48" height="1080" viewBox="0 0 48 1080"><rect width="48" height="1080" fill="%232563eb" opacity="0.08"/><line x1="47" y1="0" x2="47" y2="1080" stroke="%2338bdf8" stroke-width="1" stroke-dasharray="12,8" opacity="0.35"/><g fill="%23ffffff" opacity="0.4"><circle cx="24" cy="180" r="3"/><circle cx="24" cy="540" r="3"/><circle cx="24" cy="900" r="3"/></g></svg>`,
    tablet: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="768" viewBox="0 0 24 768"><rect width="24" height="768" fill="%232563eb" opacity="0.06"/></svg>`,
    mobile: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="6" height="854" viewBox="0 0 6 854"><rect width="6" height="854" fill="%232563eb" opacity="0.1"/></svg>`,
  },
  sideFrameRight: {
    desktop: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="48" height="1080" viewBox="0 0 48 1080"><rect width="48" height="1080" fill="%23dc2626" opacity="0.08"/><line x1="1" y1="0" x2="1" y2="1080" stroke="%23dc2626" stroke-width="1" stroke-dasharray="12,8" opacity="0.35"/><g fill="%23ffffff" opacity="0.4"><circle cx="24" cy="240" r="3"/><circle cx="24" cy="600" r="3"/><circle cx="24" cy="960" r="3"/></g></svg>`,
    tablet: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="768" viewBox="0 0 24 768"><rect width="24" height="768" fill="%23dc2626" opacity="0.06"/></svg>`,
    mobile: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="6" height="854" viewBox="0 0 6 854"><rect width="6" height="854" fill="%23dc2626" opacity="0.1"/></svg>`,
  },
  bottomForeground: {
    desktop: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="110" viewBox="0 0 1920 110"><defs><linearGradient id="patBot" x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stop-color="%2304060d" stop-opacity="0.95"/><stop offset="100%" stop-color="%2304060d" stop-opacity="0"/></linearGradient></defs><rect width="1920" height="110" fill="url(%23patBot)"/><g fill="%231e293b" opacity="0.65"><rect x="140" y="40" width="30" height="70"/><polygon points="140,40 155,20 170,40"/><rect x="220" y="55" width="45" height="55"/><rect x="1680" y="45" width="40" height="65"/><polygon points="1680,45 1700,15 1720,45"/></g></svg>`,
    tablet: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="70" viewBox="0 0 1024 70"><rect width="1024" height="70" fill="%2304060d" opacity="0.8"/></svg>`,
    mobile: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="480" height="50" viewBox="0 0 480 50"><rect width="480" height="50" fill="%2304060d" opacity="0.8"/></svg>`,
  },
  transientOverlay: {
    desktop: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><g stroke="%23fbbf24" stroke-width="2" opacity="0.8"><line x1="100" y1="100" x2="100" y2="20"/><line x1="100" y1="100" x2="180" y2="100"/><line x1="100" y1="100" x2="100" y2="180"/><line x1="100" y1="100" x2="20" y2="100"/><line x1="100" y1="100" x2="155" y2="45"/><line x1="100" y1="100" x2="155" y2="155"/><line x1="100" y1="100" x2="45" y2="155"/><line x1="100" y1="100" x2="45" y2="45"/></g><circle cx="100" cy="100" r="8" fill="%23ffffff"/></svg>`,
    tablet: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="140" height="140" viewBox="0 0 140 140"><circle cx="70" cy="70" r="40" fill="%23fbbf24" opacity="0.5"/></svg>`,
    mobile: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80"><circle cx="40" cy="40" r="25" fill="%23fbbf24" opacity="0.5"/></svg>`,
  },
};

const WINTER_ASSETS = {
  background: {
    desktop: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080"><defs><radialGradient id="aurora" cx="50%" cy="15%" r="65%"><stop offset="0%" stop-color="%2338bdf8" stop-opacity="0.30"/><stop offset="35%" stop-color="%2310b981" stop-opacity="0.18"/><stop offset="100%" stop-color="%23070d1e" stop-opacity="0"/></radialGradient><linearGradient id="winBg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="%230d1733"/><stop offset="60%" stop-color="%23070d1e"/><stop offset="100%" stop-color="%2303060f"/></linearGradient></defs><rect width="1920" height="1080" fill="url(%23winBg)"/><rect width="1920" height="1080" fill="url(%23aurora)"/><g fill="%23ffffff" opacity="0.35"><circle cx="280" cy="120" r="1.5"/><circle cx="650" cy="80" r="2"/><circle cx="950" cy="160" r="2.5"/><circle cx="1350" cy="90" r="1.5"/><circle cx="1700" cy="140" r="2"/></g><path d="M0,1080 L350,920 L750,1080 L1250,890 L1750,1080 L1920,1030 L1920,1080 Z" fill="%23122144" opacity="0.45"/></svg>`,
    tablet: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="768" viewBox="0 0 1024 768"><rect width="1024" height="768" fill="%23070d1e"/></svg>`,
    mobile: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="480" height="854" viewBox="0 0 480 854"><rect width="480" height="854" fill="%23070d1e"/></svg>`,
  },
  headerBanner: {
    desktop: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="128" viewBox="0 0 1920 128"><defs><linearGradient id="frostGrad" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="%23059669" stop-opacity="0.3"/><stop offset="50%" stop-color="%2338bdf8" stop-opacity="0.35"/><stop offset="100%" stop-color="%23dc2626" stop-opacity="0.3"/></linearGradient></defs><rect width="1920" height="128" fill="url(%23frostGrad)"/><line x1="0" y1="126" x2="1920" y2="126" stroke="%2338bdf8" stroke-width="2" opacity="0.8"/><g fill="%2338bdf8" opacity="0.65"><polygon points="200,0 206,30 212,0"/><polygon points="450,0 458,45 466,0"/><polygon points="850,0 857,35 864,0"/><polygon points="1200,0 1208,40 1216,0"/><polygon points="1600,0 1607,35 1614,0"/></g></svg>`,
    tablet: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="96" viewBox="0 0 1024 96"><rect width="1024" height="96" fill="%230d1e3d" opacity="0.5"/><line x1="0" y1="95" x2="1024" y2="95" stroke="%2338bdf8" stroke-width="1.5"/></svg>`,
    mobile: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="480" height="64" viewBox="0 0 480 64"><rect width="480" height="64" fill="%23070d1e" opacity="0.6"/><line x1="0" y1="63" x2="480" y2="63" stroke="%2338bdf8" stroke-width="1"/></svg>`,
  },
  sideFrameLeft: {
    desktop: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="52" height="1080" viewBox="0 0 52 1080"><rect width="52" height="1080" fill="%2338bdf8" opacity="0.07"/><line x1="51" y1="0" x2="51" y2="1080" stroke="%2338bdf8" stroke-width="1" stroke-dasharray="10,6" opacity="0.35"/><g fill="%23ffffff" opacity="0.45"><circle cx="26" cy="150" r="2.5"/><circle cx="26" cy="450" r="2.5"/><circle cx="26" cy="750" r="2.5"/><circle cx="26" cy="1000" r="2.5"/></g></svg>`,
    tablet: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="26" height="768" viewBox="0 0 26 768"><rect width="26" height="768" fill="%2338bdf8" opacity="0.05"/></svg>`,
    mobile: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="6" height="854" viewBox="0 0 6 854"><rect width="6" height="854" fill="%2338bdf8" opacity="0.08"/></svg>`,
  },
  sideFrameRight: {
    desktop: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="52" height="1080" viewBox="0 0 52 1080"><rect width="52" height="1080" fill="%2338bdf8" opacity="0.07"/><line x1="1" y1="0" x2="1" y2="1080" stroke="%2338bdf8" stroke-width="1" stroke-dasharray="10,6" opacity="0.35"/><g fill="%23ffffff" opacity="0.45"><circle cx="26" cy="200" r="2.5"/><circle cx="26" cy="500" r="2.5"/><circle cx="26" cy="800" r="2.5"/></g></svg>`,
    tablet: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="26" height="768" viewBox="0 0 26 768"><rect width="26" height="768" fill="%2338bdf8" opacity="0.05"/></svg>`,
    mobile: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="6" height="854" viewBox="0 0 6 854"><rect width="6" height="854" fill="%2338bdf8" opacity="0.08"/></svg>`,
  },
  bottomForeground: {
    desktop: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="120" viewBox="0 0 1920 120"><defs><linearGradient id="snowBot" x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stop-color="%23070d1e" stop-opacity="0.95"/><stop offset="100%" stop-color="%23070d1e" stop-opacity="0"/></linearGradient></defs><rect width="1920" height="120" fill="url(%23snowBot)"/><g fill="%231e3a5f" opacity="0.75"><polygon points="120,120 145,55 170,120"/><polygon points="160,120 185,45 210,120"/><polygon points="1720,120 1745,50 1770,120"/><polygon points="1760,120 1785,40 1810,120"/></g></svg>`,
    tablet: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="80" viewBox="0 0 1024 80"><rect width="1024" height="80" fill="%23070d1e" opacity="0.8"/></svg>`,
    mobile: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="480" height="55" viewBox="0 0 480 55"><rect width="480" height="55" fill="%23070d1e" opacity="0.8"/></svg>`,
  },
  transientOverlay: {
    desktop: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180"><circle cx="90" cy="90" r="10" fill="%23ffffff"/><g stroke="%2338bdf8" stroke-width="2"><line x1="90" y1="30" x2="90" y2="150"/><line x1="30" y1="90" x2="150" y2="90"/><line x1="48" y1="48" x2="132" y2="132"/><line x1="132" y1="48" x2="48" y2="132"/></g></svg>`,
    tablet: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120"><circle cx="60" cy="60" r="30" fill="%2338bdf8" opacity="0.5"/></svg>`,
    mobile: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="70" height="70" viewBox="0 0 70 70"><circle cx="35" cy="35" r="20" fill="%2338bdf8" opacity="0.5"/></svg>`,
  },
};

const SPRING_ASSETS = {
  background: {
    desktop: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080"><defs><radialGradient id="springGlow" cx="70%" cy="25%" r="45%"><stop offset="0%" stop-color="%23fb7185" stop-opacity="0.25"/><stop offset="50%" stop-color="%2310b981" stop-opacity="0.12"/><stop offset="100%" stop-color="%23042f2e" stop-opacity="0"/></radialGradient><linearGradient id="spBg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="%23064e3b"/><stop offset="50%" stop-color="%23042f2e"/><stop offset="100%" stop-color="%23021f1e"/></linearGradient></defs><rect width="1920" height="1080" fill="url(%23spBg)"/><rect width="1920" height="1080" fill="url(%23springGlow)"/><g fill="%23fb7185" opacity="0.3"><circle cx="300" cy="180" r="3"/><circle cx="550" cy="110" r="2"/><circle cx="820" cy="240" r="3"/><circle cx="1400" cy="130" r="2.5"/><circle cx="1680" cy="200" r="3"/></g><path d="M0,1080 Q450,960 960,1030 T1920,990 L1920,1080 Z" fill="%23064e3b" opacity="0.5"/></svg>`,
    tablet: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="768" viewBox="0 0 1024 768"><rect width="1024" height="768" fill="%23042f2e"/></svg>`,
    mobile: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="480" height="854" viewBox="0 0 480 854"><rect width="480" height="854" fill="%23042f2e"/></svg>`,
  },
  headerBanner: {
    desktop: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="124" viewBox="0 0 1920 124"><defs><linearGradient id="sakuraGrad" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="%2310b981" stop-opacity="0.25"/><stop offset="50%" stop-color="%23fb7185" stop-opacity="0.35"/><stop offset="100%" stop-color="%2310b981" stop-opacity="0.25"/></linearGradient></defs><rect width="1920" height="124" fill="url(%23sakuraGrad)"/><line x1="0" y1="122" x2="1920" y2="122" stroke="%23fb7185" stroke-width="2" opacity="0.75"/><g fill="%23fb7185" opacity="0.7"><circle cx="150" cy="40" r="6"/><circle cx="160" cy="48" r="6"/><circle cx="140" cy="48" r="6"/><circle cx="145" cy="58" r="6"/><circle cx="155" cy="58" r="6"/><circle cx="150" cy="51" r="3" fill="%23fef08a"/></g><g fill="%23fb7185" opacity="0.7"><circle cx="1780" cy="40" r="6"/><circle cx="1790" cy="48" r="6"/><circle cx="1770" cy="48" r="6"/><circle cx="1775" cy="58" r="6"/><circle cx="1785" cy="58" r="6"/><circle cx="1780" cy="51" r="3" fill="%23fef08a"/></g></svg>`,
    tablet: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="96" viewBox="0 0 1024 96"><rect width="1024" height="96" fill="%23064e3b" opacity="0.5"/><line x1="0" y1="95" x2="1024" y2="95" stroke="%23fb7185" stroke-width="1.5"/></svg>`,
    mobile: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="480" height="64" viewBox="0 0 480 64"><rect width="480" height="64" fill="%23042f2e" opacity="0.6"/><line x1="0" y1="63" x2="480" y2="63" stroke="%23fb7185" stroke-width="1"/></svg>`,
  },
  sideFrameLeft: {
    desktop: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="48" height="1080" viewBox="0 0 48 1080"><rect width="48" height="1080" fill="%2310b981" opacity="0.08"/><line x1="47" y1="0" x2="47" y2="1080" stroke="%23fb7185" stroke-width="1" stroke-dasharray="10,6" opacity="0.35"/><g fill="%23fb7185" opacity="0.5"><ellipse cx="24" cy="180" rx="4" ry="8" transform="rotate(30 24 180)"/><ellipse cx="24" cy="540" rx="4" ry="8" transform="rotate(-30 24 540)"/><ellipse cx="24" cy="900" rx="4" ry="8" transform="rotate(30 24 900)"/></g></svg>`,
    tablet: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="768" viewBox="0 0 24 768"><rect width="24" height="768" fill="%2310b981" opacity="0.06"/></svg>`,
    mobile: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="6" height="854" viewBox="0 0 6 854"><rect width="6" height="854" fill="%2310b981" opacity="0.08"/></svg>`,
  },
  sideFrameRight: {
    desktop: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="48" height="1080" viewBox="0 0 48 1080"><rect width="48" height="1080" fill="%23fb7185" opacity="0.08"/><line x1="1" y1="0" x2="1" y2="1080" stroke="%23fb7185" stroke-width="1" stroke-dasharray="10,6" opacity="0.35"/><g fill="%23fb7185" opacity="0.5"><ellipse cx="24" cy="220" rx="4" ry="8" transform="rotate(-30 24 220)"/><ellipse cx="24" cy="580" rx="4" ry="8" transform="rotate(30 24 580)"/><ellipse cx="24" cy="940" rx="4" ry="8" transform="rotate(-30 24 940)"/></g></svg>`,
    tablet: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="768" viewBox="0 0 24 768"><rect width="24" height="768" fill="%23fb7185" opacity="0.06"/></svg>`,
    mobile: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="6" height="854" viewBox="0 0 6 854"><rect width="6" height="854" fill="%23fb7185" opacity="0.08"/></svg>`,
  },
  bottomForeground: {
    desktop: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="110" viewBox="0 0 1920 110"><defs><linearGradient id="spBot" x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stop-color="%23021f1e" stop-opacity="0.95"/><stop offset="100%" stop-color="%23021f1e" stop-opacity="0"/></linearGradient></defs><rect width="1920" height="110" fill="url(%23spBot)"/><g fill="%23064e3b" opacity="0.75"><path d="M0,110 Q240,60 480,110 T960,110 T1440,110 T1920,110 Z"/><circle cx="220" cy="70" r="5" fill="%23fb7185"/><circle cx="580" cy="65" r="4" fill="%23fb7185"/><circle cx="1380" cy="68" r="5" fill="%23fb7185"/><circle cx="1740" cy="62" r="4" fill="%23fb7185"/></g></svg>`,
    tablet: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="70" viewBox="0 0 1024 70"><rect width="1024" height="70" fill="%23021f1e" opacity="0.8"/></svg>`,
    mobile: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="480" height="50" viewBox="0 0 480 50"><rect width="480" height="50" fill="%23021f1e" opacity="0.8"/></svg>`,
  },
  transientOverlay: {
    desktop: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><g fill="%23fb7185" opacity="0.8"><ellipse cx="80" cy="80" rx="14" ry="24" transform="rotate(45 80 80)"/><ellipse cx="50" cy="50" rx="10" ry="18" transform="rotate(20 50 50)"/><ellipse cx="110" cy="110" rx="12" ry="20" transform="rotate(60 110 110)"/></g></svg>`,
    tablet: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="110" height="110" viewBox="0 0 110 110"><ellipse cx="55" cy="55" rx="12" ry="20" fill="%23fb7185" opacity="0.6"/></svg>`,
    mobile: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="70" height="70" viewBox="0 0 70 70"><ellipse cx="35" cy="35" rx="8" ry="14" fill="%23fb7185" opacity="0.6"/></svg>`,
  },
};

const DEFAULT_NEUTRAL_THEME = {
  themeKey: "default-neutral",
  displayName: "Task Manager Neutral",
  description: "Standard clean modern enterprise skin with zero holiday decor.",
  category: "corporate",
  priority: 1,
  palette: {
    primary: "#3b82f6",
    secondary: "#6366f1",
    accent: "#60a5fa",
    accent2: "#818cf8",
    backgroundBase: "#0b1120",
    surfaceTint: "rgba(59, 130, 246, 0.04)",
    cardBorder: "rgba(255, 255, 255, 0.08)",
    cardGlow: "0 0 0 transparent",
    textColor: "#f8fafc",
    scrimWash: "rgba(11, 17, 32, 0.4)",
  },
  layout: {
    headerHeight: 64,
    bannerHeight: 0,
    sideFrameWidth: 0,
    enableSideFrames: false,
    enableBottomForeground: false,
    enableHeaderBanner: false,
  },
  animations: {
    particleType: "none",
    particleCountDesktop: 0,
    particleCountMobile: 0,
    particleColor: [],
    particleSpeed: 0,
    enableGlowPulse: false,
    transientEffectType: "none",
    transientIntervalSeconds: 0,
  },
  accessibility: {
    minContrastRatio: 4.5,
    reducedMotionAlternative: "none",
    highContrastCompatible: true,
  },
  isActive: true,
};

/**
 * Checks if a given date matches a ThemeSchedule window.
 */
function isDateInSchedule(schedule, targetDate = new Date()) {
  if (!schedule || !schedule.isActive) return false;

  const now = new Date(targetDate);

  if (schedule.scheduleType === "range") {
    if (!schedule.startDate || !schedule.endDate) return false;
    const start = new Date(schedule.startDate);
    const end = new Date(schedule.endDate);
    return now >= start && now <= end;
  }

  if (schedule.scheduleType === "fixedAnnual" && schedule.annualMonthDay) {
    const { startMonth, startDay, endMonth, endDay } = schedule.annualMonthDay;
    const curMonth = now.getUTCMonth() + 1; // 1-12
    const curDay = now.getUTCDate(); // 1-31

    const curValue = curMonth * 100 + curDay;
    const startValue = startMonth * 100 + startDay;
    const endValue = endMonth * 100 + endDay;

    // Normal date window within same calendar year
    if (startValue <= endValue) {
      return curValue >= startValue && curValue <= endValue;
    }
    // Window spans over New Year (e.g. Dec 20 to Jan 5)
    return curValue >= startValue || curValue <= endValue;
  }

  return false;
}

/**
 * Deterministic active theme resolution service implementing the exact priority chain:
 * System Accessibility Settings -> User Explicit Override -> Org Policy -> Date Schedules (sorted by priority DESC) -> Neutral Fallback.
 */
async function resolveActiveTheme({
  orgId = "default",
  userId = null,
  systemReducedMotion = false,
  clientDate = new Date(),
} = {}) {
  let resolvedThemeKey = null;
  let resolvedReason = "fallback_neutral";

  // Check Org Settings first to know if override is permitted
  let orgSettings = null;
  if (orgId) {
    orgSettings = await OrgThemeSettings.findOne({ orgId }).lean();
  }

  // Check User Preferences
  let userPref = null;
  if (userId) {
    userPref = await UserThemePreferences.findOne({ userId }).lean();
  }

  const effectivePreferences = {
    immersiveModeEnabled: userPref ? userPref.immersiveModeEnabled : true,
    animationsEnabled: true,
    reduceMotion: Boolean(systemReducedMotion || (userPref && userPref.reduceMotion)),
    particlesEnabled: userPref ? userPref.particlesEnabled : true,
    lowPerformanceMode: userPref ? userPref.lowPerformanceMode : false,
    particleCap: 35,
  };

  // Step 1: System Accessibility Settings check
  if (effectivePreferences.reduceMotion) {
    effectivePreferences.animationsEnabled = false;
    effectivePreferences.particlesEnabled = false;
  }

  if (orgSettings && orgSettings.disableAnimations) {
    effectivePreferences.animationsEnabled = false;
  }

  // Step 2: User Explicit Override
  const canUserOverride = !orgSettings || !orgSettings.enforceOrgTheme || orgSettings.allowUserOverride;
  if (
    canUserOverride &&
    userPref &&
    userPref.selectedThemeKey &&
    userPref.selectedThemeKey !== "auto"
  ) {
    resolvedThemeKey = userPref.selectedThemeKey;
    resolvedReason = "user_override";
  }

  // Step 3: Org Policy
  if (!resolvedThemeKey && orgSettings && orgSettings.enforceOrgTheme && orgSettings.forcedThemeKey) {
    resolvedThemeKey = orgSettings.forcedThemeKey;
    resolvedReason = "org_enforced";
  }

  // Step 4: Date Schedules (sorted by priority DESC)
  if (!resolvedThemeKey) {
    const schedules = await ThemeSchedule.find({ isActive: true }).sort({ priority: -1 }).lean();
    for (const schedule of schedules) {
      if (isDateInSchedule(schedule, clientDate)) {
        resolvedThemeKey = schedule.themeKey;
        resolvedReason = "schedule_match";
        break;
      }
    }
  }

  // Step 5: Fallback Neutral
  if (!resolvedThemeKey || resolvedThemeKey === "default-neutral") {
    resolvedThemeKey = "default-neutral";
    resolvedReason = "fallback_neutral";
  }

  // Fetch the theme record from DB
  let themeDoc = await HolidayTheme.findOne({ themeKey: resolvedThemeKey, isActive: true }).lean();

  if (!themeDoc) {
    if (resolvedThemeKey === "default-neutral") {
      themeDoc = DEFAULT_NEUTRAL_THEME;
    } else {
      // If requested theme not active or found, fall back to first active theme or default
      const fallbackDoc = await HolidayTheme.findOne({ isActive: true }).sort({ priority: -1 }).lean();
      themeDoc = fallbackDoc || DEFAULT_NEUTRAL_THEME;
      resolvedThemeKey = themeDoc.themeKey;
      resolvedReason = "fallback_neutral";
    }
  }

  // Fetch all theme assets for the resolved theme
  const assetDocs = await ThemeAsset.find({ themeKey: resolvedThemeKey }).lean();
  const formattedAssets = {
    background: { desktop: null, tablet: null, mobile: null },
    headerBanner: { desktop: null, tablet: null, mobile: null },
    sideFrameLeft: { desktop: null, tablet: null, mobile: null },
    sideFrameRight: { desktop: null, tablet: null, mobile: null },
    bottomForeground: { desktop: null, tablet: null, mobile: null },
    transientOverlay: { desktop: null, tablet: null, mobile: null },
    particleSprite: { desktop: null, tablet: null, mobile: null },
  };

  for (const asset of assetDocs) {
    if (formattedAssets[asset.assetType] && asset.deviceVariant) {
      formattedAssets[asset.assetType][asset.deviceVariant] = asset;
    }
  }

  return {
    resolvedThemeKey,
    resolvedReason,
    theme: themeDoc,
    assets: formattedAssets,
    effectivePreferences,
  };
}

/**
 * Seeds default holiday themes, schedules, and procedural assets into MongoDB.
 */
async function seedDefaultHolidayThemes({ performedBy = "system_startup" } = {}) {
  const themesToSeed = [
    {
      themeKey: "halloween-2026",
      displayName: "Spooky Twilight 2026",
      description: "Atmospheric twilight fog, glowing carved pumpkin motifs, and fluttering nocturnal particles.",
      category: "halloween",
      priority: 90,
      palette: {
        primary: "#ff7a1a",
        secondary: "#7b2cff",
        accent: "#00ffcc",
        accent2: "#ff0055",
        backgroundBase: "#0b0713",
        surfaceTint: "rgba(123, 44, 255, 0.12)",
        cardBorder: "rgba(255, 122, 26, 0.45)",
        cardGlow: "0 0 24px rgba(255, 122, 26, 0.28)",
        textColor: "#f8fafc",
        scrimWash: "rgba(11, 7, 19, 0.72)",
      },
      layout: {
        headerHeight: 68,
        bannerHeight: 128,
        sideFrameWidth: 56,
        enableSideFrames: true,
        enableBottomForeground: true,
        enableHeaderBanner: true,
      },
      animations: {
        particleType: "bats",
        particleCountDesktop: 35,
        particleCountMobile: 18,
        particleColor: ["#ff7a1a", "#9d4edd", "#ffffff", "#ffbe0b"],
        particleSpeed: 1.1,
        enableGlowPulse: true,
        transientEffectType: "ghost-pass",
        transientIntervalSeconds: 35,
      },
      accessibility: {
        minContrastRatio: 4.5,
        reducedMotionAlternative: "static-decorations",
        highContrastCompatible: true,
      },
      isActive: true,
      schedule: {
        scheduleType: "fixedAnnual",
        annualMonthDay: {
          startMonth: 10,
          startDay: 10,
          endMonth: 11,
          endDay: 5,
        },
        priority: 90,
      },
      assets: HALLOWEEN_ASSETS,
    },
    {
      themeKey: "patriotic-july4",
      displayName: "Independence & Liberty Gala",
      description: "Midnight navy wash, brilliant crimson accents, star badges, and radiant firework sparkle cascades.",
      category: "patriotic",
      priority: 85,
      palette: {
        primary: "#dc2626",
        secondary: "#2563eb",
        accent: "#38bdf8",
        accent2: "#fbbf24",
        backgroundBase: "#070b19",
        surfaceTint: "rgba(37, 99, 235, 0.10)",
        cardBorder: "rgba(220, 38, 38, 0.40)",
        cardGlow: "0 0 24px rgba(37, 99, 235, 0.32)",
        textColor: "#f8fafc",
        scrimWash: "rgba(7, 11, 25, 0.70)",
      },
      layout: {
        headerHeight: 64,
        bannerHeight: 120,
        sideFrameWidth: 48,
        enableSideFrames: true,
        enableBottomForeground: true,
        enableHeaderBanner: true,
      },
      animations: {
        particleType: "sparks",
        particleCountDesktop: 40,
        particleCountMobile: 20,
        particleColor: ["#ef4444", "#ffffff", "#3b82f6", "#fbbf24"],
        particleSpeed: 1.2,
        enableGlowPulse: true,
        transientEffectType: "firework-burst",
        transientIntervalSeconds: 30,
      },
      accessibility: {
        minContrastRatio: 4.5,
        reducedMotionAlternative: "static-decorations",
        highContrastCompatible: true,
      },
      isActive: true,
      schedule: {
        scheduleType: "fixedAnnual",
        annualMonthDay: {
          startMonth: 6,
          startDay: 25,
          endMonth: 7,
          endDay: 10,
        },
        priority: 85,
      },
      assets: PATRIOTIC_ASSETS,
    },
    {
      themeKey: "winter-wonderland-2026",
      displayName: "Winter Wonderland & Frost Gala",
      description: "Northern lights aurora, falling snow crystals, pine garland framing, and icy neon card borders.",
      category: "winter",
      priority: 95,
      palette: {
        primary: "#059669",
        secondary: "#dc2626",
        accent: "#38bdf8",
        accent2: "#f59e0b",
        backgroundBase: "#070d1e",
        surfaceTint: "rgba(56, 189, 248, 0.08)",
        cardBorder: "rgba(56, 189, 248, 0.42)",
        cardGlow: "0 0 25px rgba(56, 189, 248, 0.28)",
        textColor: "#f8fafc",
        scrimWash: "rgba(7, 13, 30, 0.70)",
      },
      layout: {
        headerHeight: 68,
        bannerHeight: 128,
        sideFrameWidth: 52,
        enableSideFrames: true,
        enableBottomForeground: true,
        enableHeaderBanner: true,
      },
      animations: {
        particleType: "snow",
        particleCountDesktop: 45,
        particleCountMobile: 22,
        particleColor: ["#ffffff", "#e0f2fe", "#bae6fd", "#fef08a"],
        particleSpeed: 0.9,
        enableGlowPulse: true,
        transientEffectType: "firework-burst",
        transientIntervalSeconds: 40,
      },
      accessibility: {
        minContrastRatio: 4.5,
        reducedMotionAlternative: "static-decorations",
        highContrastCompatible: true,
      },
      isActive: true,
      schedule: {
        scheduleType: "fixedAnnual",
        annualMonthDay: {
          startMonth: 12,
          startDay: 1,
          endMonth: 1,
          endDay: 10,
        },
        priority: 95,
      },
      assets: WINTER_ASSETS,
    },
    {
      themeKey: "spring-bloom-2026",
      displayName: "Spring Bloom & Sakura Gala",
      description: "Jade twilight atmosphere, fluttering cherry blossom petals, floral vines, and luminous rose accents.",
      category: "spring",
      priority: 85,
      palette: {
        primary: "#10b981",
        secondary: "#f43f5e",
        accent: "#fb7185",
        accent2: "#064e3b",
        backgroundBase: "#042f2e",
        surfaceTint: "rgba(16, 185, 129, 0.08)",
        cardBorder: "rgba(251, 113, 133, 0.40)",
        cardGlow: "0 0 24px rgba(251, 113, 133, 0.25)",
        textColor: "#f8fafc",
        scrimWash: "rgba(4, 47, 46, 0.70)",
      },
      layout: {
        headerHeight: 64,
        bannerHeight: 124,
        sideFrameWidth: 48,
        enableSideFrames: true,
        enableBottomForeground: true,
        enableHeaderBanner: true,
      },
      animations: {
        particleType: "confetti",
        particleCountDesktop: 35,
        particleCountMobile: 18,
        particleColor: ["#fb7185", "#f43f5e", "#ffffff", "#34d399"],
        particleSpeed: 0.9,
        enableGlowPulse: true,
        transientEffectType: "firework-burst",
        transientIntervalSeconds: 35,
      },
      accessibility: {
        minContrastRatio: 4.5,
        reducedMotionAlternative: "static-decorations",
        highContrastCompatible: true,
      },
      isActive: true,
      schedule: {
        scheduleType: "fixedAnnual",
        annualMonthDay: {
          startMonth: 3,
          startDay: 15,
          endMonth: 4,
          endDay: 25,
        },
        priority: 85,
      },
      assets: SPRING_ASSETS,
    },
    {
      ...DEFAULT_NEUTRAL_THEME,
      schedule: null,
      assets: null,
    },
  ];

  for (const item of themesToSeed) {
    const { schedule, assets, ...themePayload } = item;
    const theme = await HolidayTheme.findOneAndUpdate(
      { themeKey: themePayload.themeKey },
      themePayload,
      { upsert: true, new: true }
    );

    if (schedule) {
      await ThemeSchedule.findOneAndUpdate(
        { themeKey: themePayload.themeKey },
        {
          themeKey: themePayload.themeKey,
          ...schedule,
          isActive: true,
        },
        { upsert: true, new: true }
      );
    }

    if (assets) {
      for (const [assetType, variants] of Object.entries(assets)) {
        for (const [deviceVariant, cdnUrl] of Object.entries(variants)) {
          await ThemeAsset.findOneAndUpdate(
            {
              themeKey: themePayload.themeKey,
              assetType,
              deviceVariant,
            },
            {
              themeId: theme._id,
              themeKey: themePayload.themeKey,
              assetType,
              deviceVariant,
              cdnUrl,
              fallbackUrl: cdnUrl,
              format: "svg",
              loadPriority: assetType === "background" || assetType === "headerBanner" ? "critical" : "high",
            },
            { upsert: true, new: true }
          );
        }
      }
    }
  }

  await ThemeAuditLog.create({
    action: "seed_manifests",
    targetType: "system",
    targetKey: "holiday_manifests",
    performedBy,
    details: { themesSeeded: themesToSeed.map((t) => t.themeKey) },
  });

  return { ok: true, count: themesToSeed.length };
}

// --- Admin CRUD Services ---

async function getAllSchedules() {
  return await ThemeSchedule.find().sort({ priority: -1 }).lean();
}

async function upsertSchedule(scheduleData, performedBy = "admin") {
  const { _id, themeKey, scheduleType, startDate, endDate, annualMonthDay, timezone, priority, isActive } = scheduleData;
  let schedule;
  if (_id) {
    schedule = await ThemeSchedule.findByIdAndUpdate(
      _id,
      { $set: { themeKey, scheduleType, startDate, endDate, annualMonthDay, timezone, priority, isActive } },
      { new: true }
    );
  } else {
    schedule = await ThemeSchedule.create({
      themeKey,
      scheduleType,
      startDate,
      endDate,
      annualMonthDay,
      timezone: timezone || "UTC",
      priority: priority !== undefined ? priority : 10,
      isActive: isActive !== undefined ? isActive : true,
    });
  }

  await ThemeAuditLog.create({
    action: _id ? "update_schedule" : "create_schedule",
    targetType: "schedule",
    targetKey: themeKey,
    performedBy,
    details: scheduleData,
  });

  return schedule;
}

async function deleteSchedule(id, performedBy = "admin") {
  const deleted = await ThemeSchedule.findByIdAndDelete(id);
  if (deleted) {
    await ThemeAuditLog.create({
      action: "delete_schedule",
      targetType: "schedule",
      targetKey: deleted.themeKey,
      performedBy,
      details: { deletedId: id },
    });
  }
  return deleted;
}

async function getOrgSettings(orgId = "default") {
  let settings = await OrgThemeSettings.findOne({ orgId }).lean();
  if (!settings) {
    settings = await OrgThemeSettings.create({
      orgId,
      enforceOrgTheme: false,
      forcedThemeKey: null,
      allowedThemeKeys: [],
      allowUserOverride: true,
      disableAnimations: false,
    });
  }
  return settings;
}

async function updateOrgSettings(orgId = "default", updates = {}, performedBy = "admin") {
  const settings = await OrgThemeSettings.findOneAndUpdate(
    { orgId },
    { $set: updates },
    { upsert: true, new: true }
  );

  await ThemeAuditLog.create({
    action: "set_org_policy",
    targetType: "org_settings",
    targetKey: orgId,
    performedBy,
    details: updates,
  });

  return settings;
}

async function getAuditLogs(limit = 50) {
  return await ThemeAuditLog.find().sort({ timestamp: -1 }).limit(limit).lean();
}

async function upsertTheme(themeData, performedBy = "admin") {
  const { themeKey, ...rest } = themeData;
  const theme = await HolidayTheme.findOneAndUpdate(
    { themeKey },
    { $set: { themeKey, ...rest } },
    { upsert: true, new: true }
  );

  await ThemeAuditLog.create({
    action: "update_theme",
    targetType: "theme",
    targetKey: themeKey,
    performedBy,
    details: themeData,
  });

  return theme;
}

async function uploadThemeAsset(assetPayload, performedBy = "admin") {
  const { themeKey, assetType, deviceVariant, cdnUrl, fallbackUrl, format, dimensions, fileSize, loadPriority } = assetPayload;

  const theme = await HolidayTheme.findOne({ themeKey }).lean();
  const themeId = theme ? theme._id : null;

  const asset = await ThemeAsset.findOneAndUpdate(
    { themeKey, assetType, deviceVariant },
    {
      $set: {
        themeId,
        themeKey,
        assetType,
        deviceVariant,
        cdnUrl,
        fallbackUrl: fallbackUrl || cdnUrl,
        format: format || "webp",
        dimensions: dimensions || { width: 1920, height: 1080 },
        fileSize: fileSize || 0,
        loadPriority: loadPriority || "normal",
      },
    },
    { upsert: true, new: true }
  );

  await ThemeAuditLog.create({
    action: "upload_asset",
    targetType: "asset",
    targetKey: `${themeKey}:${assetType}:${deviceVariant}`,
    performedBy,
    details: { assetId: asset._id, cdnUrl },
  });

  return asset;
}

async function getThemeAssets(filter = {}) {
  const query = {};
  if (filter.themeKey) query.themeKey = filter.themeKey;
  if (filter.assetType) query.assetType = filter.assetType;
  if (filter.deviceVariant) query.deviceVariant = filter.deviceVariant;
  return await ThemeAsset.find(query).sort({ createdAt: -1 }).lean();
}

async function deleteThemeAsset(id, performedBy = "admin") {
  const deleted = await ThemeAsset.findByIdAndDelete(id);
  if (deleted) {
    await ThemeAuditLog.create({
      action: "delete_asset",
      targetType: "asset",
      targetKey: `${deleted.themeKey}:${deleted.assetType}`,
      performedBy,
      details: { deletedId: id },
    });
  }
  return deleted;
}

module.exports = {
  resolveActiveTheme,
  seedDefaultHolidayThemes,
  DEFAULT_NEUTRAL_THEME,
  getAllSchedules,
  upsertSchedule,
  deleteSchedule,
  getOrgSettings,
  updateOrgSettings,
  getAuditLogs,
  upsertTheme,
  uploadThemeAsset,
  getThemeAssets,
  deleteThemeAsset,
};
