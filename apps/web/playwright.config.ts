import { defineConfig, devices } from "@playwright/test";
import "./e2e/qa/env";

const isCi = Boolean(process.env.CI);
const argv = process.argv;
const projectArgs = argv
  .map((arg, index) => {
    if (arg.startsWith("--project=")) return arg.slice("--project=".length);
    if (arg === "--project") return argv[index + 1];
    return null;
  })
  .filter((value): value is string => Boolean(value));
const onlyProduction =
  projectArgs.length > 0 && projectArgs.every((name) => name === "qa-production");
const liveQaRequested =
  onlyProduction ||
  projectArgs.some((name) => name === "qa-local" || name === "qa-production") ||
  process.env.DRAFTY_QA_ENABLE_PROJECTS === "1";

// Propagate to worker processes (argv filters are not always identical there).
if (liveQaRequested) process.env.DRAFTY_QA_ENABLE_PROJECTS = "1";
if (onlyProduction) process.env.DRAFTY_QA_SKIP_WEBSERVER = "1";

const skipWebServer = onlyProduction || process.env.DRAFTY_QA_SKIP_WEBSERVER === "1";
const strictLiveQa = liveQaRequested || process.env.DRAFTY_QA_ENABLE_PROJECTS === "1";

export default defineConfig({
  testDir: "./e2e",
  // Keep CI regression close to main defaults. Live QA forces one worker and no retries.
  ...(strictLiveQa
    ? {
        timeout: 180_000,
        expect: { timeout: 20_000 },
        fullyParallel: false,
        workers: 1,
      }
    : {}),
  forbidOnly: isCi,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:5173",
    ...devices["Desktop Chrome"],
    ...(strictLiveQa ? { trace: "off" as const, video: "off" as const, screenshot: "off" as const } : {}),
  },
  // Do not boot the local Vite server when exercising production alone.
  webServer: skipWebServer
    ? undefined
    : {
        command: "npm run dev -- --host 127.0.0.1",
        url: "http://127.0.0.1:5173",
        reuseExistingServer: true,
      },
  // Always declare projects so worker processes see a stable project list.
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
      use: {
        baseURL: process.env.DRAFTY_QA_PRODUCTION_WEB || "https://drafty-web-umber.vercel.app",
      },
    },
  ],
});
