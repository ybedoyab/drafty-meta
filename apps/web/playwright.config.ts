import { defineConfig, devices } from "@playwright/test";
import "./e2e/qa/env";

const isCi = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  forbidOnly: isCi,
  retries: 0,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    trace: "off",
    video: "off",
    screenshot: "off",
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: true,
  },
  projects: [
    {
      name: "regression",
      testIgnore: [/qa-live\.spec\.ts/],
      use: { baseURL: "http://127.0.0.1:5173" },
    },
    {
      name: "qa-local",
      testMatch: /qa-live\.spec\.ts/,
      use: { baseURL: "http://127.0.0.1:5173" },
    },
    {
      name: "qa-production",
      testMatch: /qa-live\.spec\.ts/,
      use: { baseURL: process.env.DRAFTY_QA_PRODUCTION_WEB || "https://drafty-web-umber.vercel.app" },
    },
  ],
});
