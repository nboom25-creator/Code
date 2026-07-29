import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests for the workflows that matter most: the ones a user cannot
 * work around if they break. The dev server is started by the runner and the
 * tests run against a scratch database so they never touch real project data.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.GF_BASE_URL ?? "http://localhost:3210",
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" },
    trace: "off",
  },
  webServer: process.env.GF_BASE_URL
    ? undefined
    : {
        command: "npm run build && npm run start -- -p 3210",
        port: 3210,
        timeout: 180_000,
        reuseExistingServer: true,
        env: { GLIDERFORGE_DB: "./data/e2e.db", GLIDERFORGE_UPLOAD_DIR: "./data/e2e-uploads" },
      },
});
