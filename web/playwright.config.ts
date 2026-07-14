import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";

/**
 * Some CI images ship a preinstalled Chromium at a fixed path. If found, use it
 * (avoids `playwright install`). Otherwise Playwright uses its own download.
 */
const PREINSTALLED = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const executablePath = fs.existsSync(PREINSTALLED) ? PREINSTALLED : undefined;

/**
 * E2E config. The webServer boots the production build so tests exercise the
 * real app. Tests are written to pass WITHOUT external API keys: they assert
 * on UI shell, empty/error states, and the mobile layout rather than live AI
 * responses. See e2e/smoke.spec.ts.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: true,
  retries: 0,
  reporter: process.env.CI ? "list" : "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], launchOptions: { executablePath } } },
    { name: "mobile", use: { ...devices["Pixel 7"], launchOptions: { executablePath } } },
  ],
  webServer: {
    command: "npm run start",
    url: "http://localhost:3000",
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
  },
});
