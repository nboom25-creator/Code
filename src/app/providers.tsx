"use client";

import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/theme-provider";
import { AppStoreProvider } from "@/lib/store/store";
import { SettingsEffect } from "@/components/settings-effect";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <AppStoreProvider>
        <SettingsEffect />
        {children}
      </AppStoreProvider>
    </ThemeProvider>
  );
}
