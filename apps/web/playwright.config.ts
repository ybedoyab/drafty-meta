import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // Keep live QA settings in playwright.qa.config.ts. CI regression stays local-only.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: process.env.CI ? 1 : undefined,
  use: { baseURL: "http://127.0.0.1:5173", ...devices["Desktop Chrome"] },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
  },
});
