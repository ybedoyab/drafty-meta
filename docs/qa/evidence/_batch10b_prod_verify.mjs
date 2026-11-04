/**
 * One-shot read-only Batch 10B production Studio verification.
 * Blocks all potentially chargeable POSTs. Not a permanent CI test.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../../..");
const require = createRequire(path.join(root, "apps/web/package.json"));
const { chromium, expect } = require("@playwright/test");
const shotDir = path.join(root, "docs/screenshots");
const web = process.env.DRAFTY_QA_PRODUCTION_WEB || "https://drafty-web-umber.vercel.app";
const email = process.env.DRAFTY_QA_EMAIL;
const password = process.env.DRAFTY_QA_PASSWORD;
const job10a = "6066bc77-07d0-44ad-a49b-720b947d99fd";
const jobLegacy = "4f8ed6cc-7d26-4a53-ba2a-ba1569ab4933";
const scenarioId = "abc2180d-e0e3-4ddb-87cc-da3f8ada8c7b";

if (!email || !password) {
  console.error("Missing DRAFTY_QA_EMAIL / DRAFTY_QA_PASSWORD");
  process.exit(2);
}

const blocked = [];
const allowedPosts = [];

function isForbidden(url, method) {
  if (method !== "POST" && method !== "PUT" && method !== "PATCH" && method !== "DELETE") return false;
  const u = url.toLowerCase();
  if (u.includes("/auth/v1/token")) return false; // login
  if (u.includes("/auth/v1/logout")) return false;
  if (u.includes("/api/v1/designs/preview")) return true;
  if (u.includes("/api/v1/jobs") && !u.includes("/log") && !u.includes("/results") && !u.includes("/artifacts")) return true;
  if (u.includes("/api/v1/optimize")) return true;
  if (u.includes("/api/v1/scenarios/") && (u.includes("/turn") || u.includes("/analyze") || u.includes("/approve") || u.includes("/segment"))) return true;
  if (u.includes("modal") && method !== "GET") return true;
  if (u.includes("meta") && u.includes("/chat")) return true;
  if (u.includes("/geometry/") && method === "POST") return true;
  return false;
}

async function showRunStep(page, label) {
  await page.locator('nav[aria-label="Run steps"]').getByRole("button", { name: new RegExp(label) }).click();
}

async function openJobResults(page, jobId) {
  await page.goto("/studio");
  await page.getByRole("tab", { name: /Jobs queue/ }).click();
  await expect(page.getByRole("cell", { name: jobId.slice(0, 8) })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("cell", { name: jobId.slice(0, 8) }).click();
  await showRunStep(page, "Results");
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ baseURL: web, viewport: { width: 1440, height: 900 } });
await context.route("**/*", async (route) => {
  const req = route.request();
  const method = req.method();
  const url = req.url();
  if (isForbidden(url, method)) {
    blocked.push({ method, url, at: new Date().toISOString() });
    console.error("BLOCKED_PAID", method, url);
    await route.fulfill({
      status: 599,
      contentType: "application/json",
      body: JSON.stringify({ detail: "blocked by Batch 10B read-only QA interceptor" }),
    });
    return;
  }
  if (method === "POST") {
    allowedPosts.push({ method, url: url.split("?")[0], at: new Date().toISOString() });
  }
  await route.continue();
});

const page = await context.newPage();
const report = {
  web,
  mergeShaHint: "d05cd76",
  blockedPaidPosts: 0,
  allowedPosts: [],
  checks: {},
  errors: [],
};

try {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/projects/, { timeout: 60_000 });
  report.checks.auth = "PASS";

  // --- Batch 10A ---
  await openJobResults(page, job10a);
  await expect(page.getByRole("heading", { name: "Solver completion" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("quality-gates")).toBeVisible();
  await expect(page.getByTestId("mesh-quality")).toBeVisible();
  await expect(page.getByTestId("mesh-quality").getByText("C3D10").first()).toBeVisible();
  await expect(page.getByTestId("mesh-quality").getByText("18980").first()).toBeVisible();
  await expect(page.getByText("sampled_ok_certification_inconclusive")).toBeVisible();
  await expect(page.getByTestId("quality-gates").getByText("passed_sampled")).toBeVisible();
  await expect(page.getByText("Whole-element certification", { exact: true })).toBeVisible();
  await expect(page.getByTestId("mesh-quality").getByText("inconclusive", { exact: true }).first()).toBeVisible();
  // Soft warnings may include honest Batch 10A limitation notes from the retained job.
  // Fail only if a false "below 0.10" low-ratio warning appears on this high-ratio mesh.
  const soft = page.getByTestId("mesh-soft-warning");
  const softCount = await soft.count();
  let softTexts = [];
  for (let i = 0; i < softCount; i += 1) softTexts.push(await soft.nth(i).innerText());
  const falseLowRatio = softTexts.some((t) => /below 0\.10/i.test(t));
  report.checks.batch10aSoftWarnings = softTexts;
  report.checks.falseLowRatioWarning = falseLowRatio ? "FAIL" : "PASS";
  if (falseLowRatio) report.errors.push("false low-ratio warning displayed for high-quality mesh");

  // inverted / degenerate zeros appear as Row values
  await page.getByTestId("mesh-quality").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(shotDir, "prod-batch10b-mesh-quality-10a.png"),
    fullPage: false,
  });
  report.checks.batch10aResults = "PASS";

  // reload persistence
  await page.reload();
  await page.getByRole("tab", { name: /Jobs queue/ }).click();
  await page.getByRole("cell", { name: job10a.slice(0, 8) }).click();
  await showRunStep(page, "Results");
  await expect(page.getByTestId("mesh-quality")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("sampled_ok_certification_inconclusive")).toBeVisible();
  report.checks.reloadPersistence = "PASS";

  // --- Legacy ---
  await openJobResults(page, jobLegacy);
  await expect(page.getByTestId("mesh-quality-legacy")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/legacy|predates Batch 10A/i).first()).toBeVisible();
  await expect(page.getByText("certified_valid")).toHaveCount(0);
  await page.getByTestId("mesh-quality").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(shotDir, "prod-batch10b-mesh-quality-legacy.png"),
    fullPage: false,
  });
  report.checks.legacyCompatibility = "PASS";

  // --- Passive preview safety ---
  const previewPostsBefore = blocked.filter((b) => b.url.includes("/designs/preview")).length;
  await page.goto(`/scenario/${scenarioId}`);
  await page.waitForTimeout(1500);
  await page.goto(`/studio?scenario=${scenarioId}`);
  await expect(page.getByText("Preview when you need geometry")).toBeVisible({ timeout: 60_000 });
  await page.reload();
  await expect(page.getByText("Preview when you need geometry")).toBeVisible({ timeout: 60_000 });
  // Explicit preview controls remain available on Loads / Apply strip; do not click them.
  await page.locator('nav[aria-label="Design steps"]').getByRole("button", { name: /Loads/ }).click();
  await expect(page.getByRole("button", { name: "Preview solid" })).toBeVisible();
  await page.goto(`/scenario/${scenarioId}`);
  const modelBtn = page.locator('nav[aria-label="Inspector steps"]').getByRole("button", { name: /Model/ });
  if (await modelBtn.count()) {
    await modelBtn.click();
    await expect(page.getByRole("button", { name: /Generate preview|Rebuild preview/ })).toBeVisible({
      timeout: 30_000,
    });
  }
  await page.screenshot({
    path: path.join(shotDir, "prod-batch10b-preview-gated.png"),
    fullPage: false,
  });
  const previewPostsAfter = blocked.filter((b) => b.url.includes("/designs/preview")).length;
  report.checks.previewPostsDuringPassiveNav = previewPostsAfter - previewPostsBefore;
  if (previewPostsAfter !== previewPostsBefore) {
    report.errors.push("interceptor recorded designs/preview during passive navigation");
  }
  report.checks.previewSafety = "PASS";
} catch (err) {
  report.errors.push(String(err && err.stack ? err.stack : err));
  try {
    await page.screenshot({ path: path.join(shotDir, "prod-batch10b-failure.png"), fullPage: true });
  } catch {
    /* ignore */
  }
} finally {
  report.blockedPaidPosts = blocked.length;
  report.blocked = blocked;
  report.allowedPosts = allowedPosts;
  const out = path.join(__dirname, `batch10b-prod-verify_${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ out, blocked: blocked.length, errors: report.errors, checks: report.checks }, null, 2));
  await browser.close();
  if (report.errors.length || blocked.length > 0) process.exit(1);
}
