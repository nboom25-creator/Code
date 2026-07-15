export type ThemePreference = "light" | "dark" | "system";
export type TextSize = "small" | "default" | "large";
export type UnitSystem = "us" | "metric";

export interface AppSettings {
  theme: ThemePreference;
  textSize: TextSize;
  reducedMotion: boolean;
  units: UnitSystem;
  notifyProgress: boolean;
  notifySafety: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  textSize: "default",
  reducedMotion: false,
  units: "us",
  notifyProgress: true,
  notifySafety: true,
};

export const TEXT_SIZE_SCALE: Record<TextSize, string> = {
  small: "93.75%",
  default: "100%",
  large: "112.5%",
};
