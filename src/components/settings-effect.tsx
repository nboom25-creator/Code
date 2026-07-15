"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";
import { useAppStore } from "@/lib/store/store";
import { TEXT_SIZE_SCALE } from "@/lib/settings";

/**
 * Applies user accessibility settings to the document: theme, text size, and
 * reduced motion. Runs only after hydration so the server/client markup match.
 */
export function SettingsEffect() {
  const { data, hydrated } = useAppStore();
  const { setTheme } = useTheme();
  const { theme, textSize, reducedMotion } = data.settings;

  useEffect(() => {
    if (!hydrated) return;
    setTheme(theme);
  }, [hydrated, theme, setTheme]);

  useEffect(() => {
    if (!hydrated) return;
    document.documentElement.style.fontSize = TEXT_SIZE_SCALE[textSize];
  }, [hydrated, textSize]);

  useEffect(() => {
    if (!hydrated) return;
    document.documentElement.dataset.reducedMotion = reducedMotion
      ? "true"
      : "false";
  }, [hydrated, reducedMotion]);

  return null;
}
