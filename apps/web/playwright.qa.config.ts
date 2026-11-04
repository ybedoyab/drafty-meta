/**
 * Live QA Playwright config (local + production).
 *
 * Keep this separate from playwright.config.ts so CI regression stays identical to main.
 *
 *   npm run test:qa-local
 *   npm run test:qa-production
 */
import { defineConfig, devices } from "@playwright/test";
import "./e2e/qa/env";

const onlyProduction = process.argv.some(
  (arg, index, all) =>
    arg === "--project=qa-production" || (arg === "--project" && all[index + 1] === "qa-production"),
);

export default defineConfig({
  testDir: "./e2e",
  testMatch: /qa-live\.spec\.ts/,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    trace: "off",
    video: "off",
    screenshot: "off",
  },
  webServer: onlyProduction
    ? undefined
    : {
        command: "npm run dev -- --host 127.0.0.1",
        url: "http://127.0.0.1:5173",
        reuseExistingServer: true,
      },
  projects: [
    {
      name: "qa-local",
      use: { baseURL: process.env.DRAFTY_QA_LOCAL_WEB || "http://127.0.0.1:5173" },
    },
    {
      name: "qa-production",
      use: {
        baseURL: process.env.DRAFTY_QA_PRODUCTION_WEB || "https://drafty-web-umber.vercel.app",
      },
    },
  ],
});
