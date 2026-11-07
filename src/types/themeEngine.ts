/**
 * Task Manager® Holiday Immersive Theme Engine - Backend Type Definitions
 */

export type DeviceVariant = "desktop" | "tablet" | "mobile";

export type AssetType =
  | "background"
  | "headerBanner"
  | "sideFrameLeft"
  | "sideFrameRight"
  | "bottomForeground"
  | "transientOverlay"
  | "particleSprite";

export type ParticleType = "bats" | "sparks" | "snow" | "confetti" | "lanterns" | "stars" | "none";
export type TransientEffectType = "ghost-pass" | "firework-burst" | "none";
export type LoadPriority = "critical" | "high" | "normal" | "low";
export type ScheduleType = "fixedAnnual" | "calculated" | "range";

export interface ThemePalette {
  primary: string;
  secondary: string;
  accent: string;
  accent2: string;
  backgroundBase: string;
  surfaceTint: string;
  cardBorder: string;
  cardGlow: string;
  textColor: string;
  scrimWash: string;
}

export interface ThemeLayout {
  headerHeight: number;
  bannerHeight: number;
  sideFrameWidth: number;
  enableSideFrames: boolean;
  enableBottomForeground: boolean;
  enableHeaderBanner: boolean;
}

export interface ThemeAnimations {
  particleType: ParticleType;
  particleCountDesktop: number;
  particleCountMobile: number;
  particleColor: string[];
  particleSpeed: number;
  enableGlowPulse: boolean;
  transientEffectType: TransientEffectType;
  transientIntervalSeconds: number;
}

export interface ThemeAccessibility {
  minContrastRatio: number;
  reducedMotionAlternative: string;
  highContrastCompatible: boolean;
}

export interface IHolidayTheme {
  _id?: string;
  themeKey: string;
  displayName: string;
  description: string;
  category: "halloween" | "patriotic" | "winter" | "spring" | "cultural" | "corporate" | "custom";
  priority: number;
  palette: ThemePalette;
  layout: ThemeLayout;
  animations: ThemeAnimations;
  accessibility: ThemeAccessibility;
  isActive: boolean;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

export interface IThemeAsset {
  _id?: string;
  themeId: string;
  themeKey: string;
  deviceVariant: DeviceVariant;
  assetType: AssetType;
  cdnUrl: string;
  fallbackUrl?: string;
  dimensions: { width: number; height: number };
  fileSize: number;
  format: "webp" | "avif" | "png" | "svg" | "jpeg";
  loadPriority: LoadPriority;
  meta?: Record<string, unknown>;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

export interface IThemeSchedule {
  _id?: string;
  themeKey: string;
  scheduleType: ScheduleType;
  startDate?: string | Date;
  endDate?: string | Date;
  annualMonthDay?: {
    startMonth: number;
    startDay: number;
    endMonth: number;
    endDay: number;
  };
  timezone: string;
  priority: number;
  isActive: boolean;
}

export interface IOrgThemeSettings {
  _id?: string;
  orgId: string;
  enforceOrgTheme: boolean;
  forcedThemeKey?: string | null;
  allowedThemeKeys: string[];
  allowUserOverride: boolean;
  disableAnimations: boolean;
}

export interface IUserThemePreferences {
  _id?: string;
  userId: string;
  orgId: string;
  selectedThemeKey: string; // "auto" | explicit key | "default-neutral"
  immersiveModeEnabled: boolean;
  reduceMotion: boolean;
  lowPerformanceMode: boolean;
  particlesEnabled: boolean;
}

export interface IThemeAuditLog {
  _id?: string;
  action: string;
  targetType: "theme" | "schedule" | "asset" | "org_settings" | "user_preference" | "system";
  targetKey?: string;
  performedBy: string;
  details: Record<string, unknown>;
  timestamp: string | Date;
}

export interface ActiveThemeResolution {
  resolvedThemeKey: string;
  resolvedReason:
    | "system_reduced_motion"
    | "user_override"
    | "org_enforced"
    | "schedule_match"
    | "fallback_neutral";
  theme: IHolidayTheme;
  assets: Record<AssetType, Record<DeviceVariant, IThemeAsset | null>>;
  effectivePreferences: {
    immersiveModeEnabled: boolean;
    animationsEnabled: boolean;
    reduceMotion: boolean;
    particlesEnabled: boolean;
    particleCap: number;
  };
}
