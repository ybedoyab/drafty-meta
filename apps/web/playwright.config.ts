import { defineConfig, devices, type PlaywrightTestConfig } from "@playwright/test";

// NOTE: Do not import ./e2e/qa/env here. That side-effect loader can alter process.env
// for the Vite webServer child and broke CI regression. qa-live.spec.ts imports it instead.

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

if (liveQaRequested) {
  process.env.DRAFTY_QA_ENABLE_PROJECTS = "1";
}
if (onlyProduction) {
  process.env.DRAFTY_QA_SKIP_WEBSERVER = "1";
}

const skipWebServer = onlyProduction || process.env.DRAFTY_QA_SKIP_WEBSERVER === "1";
const strictLiveQa = liveQaRequested || process.env.DRAFTY_QA_ENABLE_PROJECTS === "1";

const regressionConfig: PlaywrightTestConfig = {
  testDir: "./e2e",
  use: { baseURL: "http://127.0.0.1:5173", ...devices["Desktop Chrome"] },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: true,
  },
};

const liveQaConfig: PlaywrightTestConfig = {
  testDir: "./e2e",
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
  webServer: skipWebServer
    ? undefined
    : {
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
      use: {
        baseURL: process.env.DRAFTY_QA_PRODUCTION_WEB || "https://drafty-web-umber.vercel.app",
      },
    },
  ],
};

export default defineConfig(strictLiveQa ? liveQaConfig : regressionConfig);
