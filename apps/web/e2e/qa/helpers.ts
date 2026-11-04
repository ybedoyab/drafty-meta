import { expect, type APIRequestContext, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import {
  QA_PREFIX,
  SCREENSHOT_DIR,
  ensureScreenshotDir,
  hasPrimaryCredentials,
  qaEnv,
  redact,
} from "./env";
import { mayCleanupScenario, retainScenarioEvidence } from "./evidence";

/** Known DRAFTY_QA leftover IDs from earlier local FEM iterations (pre Storage delete fix). */
export const KNOWN_QA_LEFTOVER_IDS = [
  "d27dd637-c521-44b5-932d-e205a5846b37",
  "7d41ac60-112c-407b-ba55-79bb1e0645e0",
  "c658a20c-7c2e-4738-98a8-89282610a2fc",
  "229f8821-1538-476a-aaf9-29a320424402",
  "5284c7a3-b0bf-46f8-b220-f562df3252ff",
  "535f2a7f-de71-4e18-a56c-3f887de1af7f",
] as const;

export type TrackedResource = {
  scenarioId: string;
  name: string;
  owner: "primary" | "secondary";
  /** When true, afterAll / leftover cleanup must not delete this scenario. */
  retain?: boolean;
};

const tracked: TrackedResource[] = [];

export function trackedResources(): TrackedResource[] {
  return [...tracked];
}

export function trackScenario(resource: TrackedResource): void {
  // Keep the durable ledger in sync so afterAll / other processes honor retain.
  if (resource.retain) {
    retainScenarioEvidence(resource.scenarioId);
  }
  const existing = tracked.find((item) => item.scenarioId === resource.scenarioId);
  if (existing) {
    if (resource.retain) existing.retain = true;
    if (resource.name) existing.name = resource.name;
    return;
  }
  tracked.push({ ...resource });
}

export function qaScenarioName(suffix: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `${QA_PREFIX}${suffix}_${stamp}`;
}

export async function signIn(page: Page, which: "primary" | "secondary" = "primary"): Promise<void> {
  if (which === "primary" && !hasPrimaryCredentials()) {
    throw new Error("Primary QA credentials are not configured.");
  }
  if (which === "secondary" && !(qaEnv.email2 && qaEnv.password2)) {
    throw new Error("Secondary QA credentials are not configured.");
  }
  const email = which === "primary" ? qaEnv.email : qaEnv.email2;
  const password = which === "primary" ? qaEnv.password : qaEnv.password2;
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  const listOk = page.waitForResponse(
    (res) =>
      res.url().includes("/api/v1/scenarios") &&
      res.request().method() === "GET" &&
      res.status() === 200,
    { timeout: 60_000 },
  );
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/projects/, { timeout: 45_000 });
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  try {
    await listOk;
  } catch {
    await page.goto("/projects");
    await page.waitForResponse(
      (res) =>
        res.url().includes("/api/v1/scenarios") &&
        res.request().method() === "GET" &&
        res.status() === 200,
      { timeout: 45_000 },
    );
  }
}

export async function signOut(page: Page): Promise<void> {
  const button = page.getByRole("button", { name: "Sign out" });
  if (await button.count()) {
    await button.click();
    await page.waitForTimeout(300);
  }
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: /Sign in/i })).toBeVisible({ timeout: 45_000 });
}

export async function accessTokenFromPage(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const candidates: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key) continue;
      const raw = localStorage.getItem(key);
      if (!raw || !raw.includes("access_token")) continue;
      try {
        const parsed = JSON.parse(raw) as {
          access_token?: string;
          currentSession?: { access_token?: string };
          session?: { access_token?: string };
        };
        if (typeof parsed.access_token === "string") candidates.push(parsed.access_token);
        if (typeof parsed.currentSession?.access_token === "string") {
          candidates.push(parsed.currentSession.access_token);
        }
        if (typeof parsed.session?.access_token === "string") candidates.push(parsed.session.access_token);
      } catch {
        // keep scanning
      }
    }
    // Prefer JWT-shaped tokens from sb-*-auth-token style keys.
    const jwt = candidates.find((token) => token.startsWith("eyJ") && token.split(".").length === 3);
    return jwt || candidates[0] || null;
  });
}

/** Capture a JWT the local API accepts after sign-in. */
export async function waitForBrowserAccessToken(
  page: Page,
  apiBase = qaEnv.localApi,
  timeoutMs = 45_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const fromStorage = await accessTokenFromPage(page);
    if (fromStorage?.startsWith("eyJ")) {
      const status = await page.evaluate(
        async ({ base, token }) => {
          const response = await fetch(`${base.replace(/\/$/, "")}/api/v1/scenarios`, {
            headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
          });
          return response.status;
        },
        { base: apiBase, token: fromStorage },
      );
      if (status < 400) return fromStorage;
    }
    await page.waitForTimeout(400);
  }
  throw new Error("Timed out waiting for a browser Supabase access token accepted by the API.");
}

export async function recallScenarioIdFromPage(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem("drafty.scenario.v2") || "") as {
        version?: number;
        id?: string;
      };
      return parsed.version === 2 && parsed.id ? parsed.id : null;
    } catch {
      return null;
    }
  });
}

export async function apiJson(
  request: APIRequestContext,
  apiBase: string,
  method: "GET" | "POST" | "DELETE",
  route: string,
  token: string | null,
  body?: unknown,
): Promise<{ status: number; json: any; headers: Record<string, string> }> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await request.fetch(`${apiBase.replace(/\/$/, "")}${route}`, {
    method,
    headers,
    data: body === undefined ? undefined : body,
  });
  let json: any = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  const responseHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(response.headers())) {
    responseHeaders[key] = value;
  }
  return { status: response.status(), json, headers: responseHeaders };
}

export async function createNamedScenario(
  page: Page,
  request: APIRequestContext,
  apiBase: string,
  name: string,
  owner: "primary" | "secondary" = "primary",
): Promise<string> {
  const token = await waitForBrowserAccessToken(page, apiBase);
  // Create via UI so the browser session and API stay aligned.
  const created = page.waitForResponse(
    (res) =>
      res.url().includes("/api/v1/scenarios") &&
      !res.url().includes("/turn") &&
      !res.url().includes("/demo") &&
      res.request().method() === "POST" &&
      res.status() < 400,
    { timeout: 60_000 },
  );
  await page.goto("/scenario/new");
  const response = await created;
  const body = (await response.json()) as { id: string };
  const scenarioId = body.id;
  expect(scenarioId).toBeTruthy();
  const renamed = await apiJson(request, apiBase, "POST", `/api/v1/scenarios/${scenarioId}/rename`, token, {
    name,
  });
  if (renamed.status >= 400) {
    // Retry rename once with a freshly read token (session may have refreshed).
    const refreshed = await accessTokenFromPage(page);
    const again = await apiJson(request, apiBase, "POST", `/api/v1/scenarios/${scenarioId}/rename`, refreshed, {
      name,
    });
    expect(again.status, redact(JSON.stringify(again.json))).toBeLessThan(400);
  }
  trackScenario({ scenarioId, name, owner });
  return scenarioId;
}

export async function openScenarioFromProjects(page: Page, name: string): Promise<void> {
  await page.goto("/projects");
  const row = page.locator("li").filter({ hasText: name }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.getByRole("link", { name: "Open" }).click();
  await expect(page.getByLabel("Describe the problem")).toBeVisible({ timeout: 30_000 });
}

export async function deleteScenarioByName(page: Page, name: string): Promise<void> {
  await page.goto("/projects");
  const row = page.locator("li").filter({ hasText: name }).first();
  if ((await row.count()) === 0) return;
  await row.getByRole("button", { name: "Delete" }).click();
  await row.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText(name)).toHaveCount(0, { timeout: 30_000 });
}

export async function safeScreenshot(page: Page, fileName: string): Promise<void> {
  ensureScreenshotDir();
  await page
    .locator('input[type="password"]')
    .evaluateAll((nodes) => {
      for (const node of nodes) (node as HTMLInputElement).value = "";
    })
    .catch(() => undefined);
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, fileName),
    fullPage: true,
  });
}

export async function showInspectorStep(page: Page, label: string): Promise<void> {
  await page
    .locator('nav[aria-label="Inspector steps"]')
    .getByRole("button", { name: new RegExp(label) })
    .click();
}

export async function cleanupTracked(
  request: APIRequestContext,
  apiBase: string,
  page: Page,
): Promise<{ deleted: string[]; failed: string[] }> {
  const deleted: string[] = [];
  const failed: string[] = [];
  // Prefer primary session token if present.
  let token = await accessTokenFromPage(page);
  if (!token) {
    try {
      await signIn(page, "primary");
      token = await accessTokenFromPage(page);
    } catch {
      token = null;
    }
  }
  const remaining: TrackedResource[] = [];
  const production = Boolean(qaEnv.runProduction);
  for (const item of [...tracked].reverse()) {
    // Single gate: mayCleanupScenario (honors ledger + DRAFTY_QA_RELEASE_RETAINED).
    // Tracked retain always mirrors the durable ledger via trackScenario().
    if (!mayCleanupScenario(item.scenarioId, { production })) {
      remaining.push(item);
      continue;
    }
    try {
      let result = await apiJson(request, apiBase, "DELETE", `/api/v1/scenarios/${item.scenarioId}`, token);
      // Cleanup is retryable when private artifact purge is incomplete (HTTP 503).
      if (result.status === 503) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        result = await apiJson(request, apiBase, "DELETE", `/api/v1/scenarios/${item.scenarioId}`, token);
      }
      if (result.status < 400 || result.status === 404) deleted.push(item.scenarioId);
      else {
        const detail = redact(JSON.stringify(result.json?.detail || result.json || {})).slice(0, 500);
        failed.push(`${item.scenarioId}:${result.status}:${detail}`);
      }
    } catch (error) {
      failed.push(`${item.scenarioId}:${redact(String(error))}`);
    }
  }
  tracked.length = 0;
  tracked.push(...remaining.reverse());
  if (failed.length) {
    ensureScreenshotDir();
    fs.writeFileSync(
      path.join(SCREENSHOT_DIR, "cleanup-leftovers.json"),
      JSON.stringify({ failed, at: new Date().toISOString() }, null, 2),
    );
  }
  return { deleted, failed };
}

/**
 * Delete only scenarios owned by the authenticated QA account whose names start with DRAFTY_QA_,
 * plus any explicitly listed leftover IDs that still resolve for this owner.
 */
export async function cleanupQaOwnedLeftovers(
  request: APIRequestContext,
  apiBase: string,
  page: Page,
  extraIds: string[] = [...KNOWN_QA_LEFTOVER_IDS],
): Promise<{ deleted: string[]; skipped: string[]; failed: string[] }> {
  const deleted: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];
  await signIn(page, "primary");
  const token = await accessTokenFromPage(page);
  expect(token).toBeTruthy();

  const listed = await apiJson(request, apiBase, "GET", "/api/v1/scenarios", token);
  expect(listed.status).toBe(200);
  const scenarios = Array.isArray(listed.json?.scenarios) ? listed.json.scenarios : [];
  const byId = new Map<string, { id: string; name?: string }>();
  for (const row of scenarios) {
    const id = String(row?.id || "");
    const name = String(row?.name || "");
    if (id && name.startsWith(QA_PREFIX)) byId.set(id, { id, name });
  }
  for (const id of extraIds) {
    if (byId.has(id)) continue;
    const probe = await apiJson(request, apiBase, "GET", `/api/v1/scenarios/${id}`, token);
    if (probe.status === 200 && String(probe.json?.name || "").startsWith(QA_PREFIX)) {
      byId.set(id, { id, name: String(probe.json.name) });
    } else if (probe.status === 404) {
      skipped.push(`${id}:already-gone`);
    } else if ([401, 403].includes(probe.status)) {
      skipped.push(`${id}:not-owned`);
    } else {
      skipped.push(`${id}:http-${probe.status}`);
    }
  }

  const production = Boolean(qaEnv.runProduction);
  const jobsResp = await apiJson(request, apiBase, "GET", "/api/v1/jobs", token);
  const linkedScenarioIds = new Set<string>();
  if (jobsResp.status === 200 && Array.isArray(jobsResp.json?.jobs)) {
    for (const job of jobsResp.json.jobs) {
      const sid = String(job?.scenario_id || "");
      if (sid) linkedScenarioIds.add(sid);
    }
  }

  for (const item of byId.values()) {
    const hasLinkedJobs = linkedScenarioIds.has(item.id);
    if (!mayCleanupScenario(item.id, { production, hasLinkedJobs })) {
      const reason =
        production && hasLinkedJobs && mayCleanupScenario(item.id)
          ? "job-linked-evidence"
          : "retained-evidence";
      skipped.push(`${item.id}:${reason}`);
      continue;
    }
    let result = await apiJson(request, apiBase, "DELETE", `/api/v1/scenarios/${item.id}`, token);
    if (result.status === 503) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      result = await apiJson(request, apiBase, "DELETE", `/api/v1/scenarios/${item.id}`, token);
    }
    if (result.status < 400 || result.status === 404) deleted.push(`${item.id}:${item.name || ""}`);
    else failed.push(`${item.id}:${result.status}`);
  }
  return { deleted, skipped, failed };
}

export function assertNonEmptyBinary(buffer: Buffer, kind: "stl" | "step"): void {
  expect(buffer.byteLength).toBeGreaterThan(64);
  if (kind === "stl") {
    const ascii = buffer.subarray(0, 5).toString("ascii").toLowerCase();
    expect(ascii === "solid" || buffer.byteLength > 84).toBeTruthy();
  }
  if (kind === "step") {
    const head = buffer.subarray(0, 64).toString("ascii");
    expect(head.includes("ISO-10303") || head.includes("STEP") || head.includes("HEADER")).toBeTruthy();
  }
}

export async function collectPageErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(redact(error.message)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(redact(message.text()));
  });
  return errors;
}

const TERMINAL_JOB_STATUSES = new Set(["completed", "failed", "cancelled", "error"]);

export async function waitForJobTerminal(
  request: APIRequestContext,
  apiBase: string,
  jobId: string,
  token: string | null,
  timeoutMs = 240_000,
): Promise<{ status: number; json: any }> {
  const deadline = Date.now() + timeoutMs;
  let last: { status: number; json: any } = { status: 0, json: null };
  while (Date.now() < deadline) {
    last = await apiJson(request, apiBase, "GET", `/api/v1/jobs/${jobId}`, token);
    const jobStatus = String(last.json?.status || "");
    if (last.status === 200 && TERMINAL_JOB_STATUSES.has(jobStatus)) {
      return last;
    }
    if (last.status >= 400 && last.status !== 404) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_500));
  }
  throw new Error(
    `Job ${jobId} did not reach a terminal state within ${timeoutMs}ms; last=${redact(
      JSON.stringify({ http: last.status, status: last.json?.status, message: last.json?.message }),
    )}`,
  );
}

/** Confirm faces → Studio → Run analysis; poll API until completed; assert FEM results. */
export async function runApprovedBracketFem(
  page: Page,
  request: APIRequestContext,
  apiBase: string,
  opts: {
    expectCompute?: "local" | "modal";
    timeoutMs?: number;
    /** Called immediately after POST /jobs succeeds — before poll or report downloads. */
    onJobSubmitted?: (job: { id: string; status: string; compute?: string }) => void;
  } = {},
): Promise<{ jobId: string; results: any; report: any }> {
  await showInspectorStep(page, "Results");
  await page.getByLabel("Fixed face").selectOption("xmin");
  await page.getByLabel("Load face").selectOption("zmax");
  await page.getByRole("button", { name: "Confirm faces" }).click();
  await expect(page.getByRole("button", { name: "Approve and open Studio" })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Approve and open Studio" }).click();
  await expect(page.getByLabel("Part")).toHaveValue("l_bracket", { timeout: 60_000 });
  await expect(page.getByLabel("Order")).toHaveValue("2");

  if (opts.expectCompute === "modal") {
    const modalRadio = page.getByLabel(/Modal/i);
    if (await modalRadio.count()) {
      await modalRadio.check().catch(async () => {
        await page.getByText(/Modal Cloud/i).first().click();
      });
    }
  }

  const jobResponsePromise = page.waitForResponse(
    (res) =>
      res.url().includes("/api/v1/jobs") &&
      !res.url().match(/\/jobs\/[^/]+/) &&
      res.request().method() === "POST" &&
      res.status() < 500,
    { timeout: 60_000 },
  );
  await page.getByRole("button", { name: "Run analysis" }).click();
  const jobResponse = await jobResponsePromise;
  expect(jobResponse.status(), "job submission HTTP status").toBeLessThan(400);
  const submitted = (await jobResponse.json()) as { id: string; status: string; compute?: string };
  expect(submitted.id).toBeTruthy();
  // Persist the id before any poll / report assertion so a later 404 cannot erase it.
  opts.onJobSubmitted?.(submitted);
  const token = await accessTokenFromPage(page);
  const terminal = await waitForJobTerminal(
    request,
    apiBase,
    submitted.id,
    token,
    opts.timeoutMs ?? 240_000,
  );
  expect(terminal.status).toBe(200);
  expect(terminal.json?.status, redact(JSON.stringify(terminal.json))).toBe("completed");

  const resultsResp = await apiJson(request, apiBase, "GET", `/api/v1/jobs/${submitted.id}/results`, token);
  expect(resultsResp.status).toBe(200);
  const results = resultsResp.json;
  expect(String(results?.solver?.name || "").toLowerCase()).toContain("calculix");
  expect(Number(results?.mesh?.nodes)).toBeGreaterThan(10);
  expect(Number(results?.mesh?.elements)).toBeGreaterThan(5);
  expect(String(results?.mesh?.element_type || "")).toMatch(/C3D/i);
  expect(Number(results?.max_displacement_m)).toBeGreaterThan(0);
  expect(Number(results?.max_von_mises_pa)).toBeGreaterThan(0);
  expect(Number(results?.governing_von_mises_pa)).toBeGreaterThan(0);
  expect(results?.equilibrium).toBeTruthy();
  expect(typeof results?.equilibrium?.passed).toBe("boolean");
  expect(Array.isArray(results?.warnings) || results?.warnings == null).toBeTruthy();

  await expect(page.getByText("Governing von Mises", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/not a certified safety factor/i).first()).toBeVisible();

  const reportLink = page.getByRole("link", { name: /report\.(json|pdf)/i }).first();
  await expect(reportLink).toBeVisible({ timeout: 30_000 });
  let report: any = null;
  const reportJson = await apiJson(
    request,
    apiBase,
    "GET",
    `/api/v1/jobs/${submitted.id}/artifacts/report.json`,
    token,
  );
  if (reportJson.status < 400 && reportJson.json) {
    report = reportJson.json;
    expect(JSON.stringify(report).toLowerCase()).toContain("calculix");
  } else {
    const reportHref = await reportLink.getAttribute("href");
    expect(reportHref).toBeTruthy();
    const reportFetch = await request.get(new URL(reportHref!, apiBase).toString(), {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    expect(reportFetch.ok(), `report download HTTP ${reportFetch.status()}`).toBeTruthy();
    const contentType = reportFetch.headers()["content-type"] || "";
    if (contentType.includes("json") || (reportHref || "").endsWith(".json")) {
      report = await reportFetch.json();
      expect(JSON.stringify(report).toLowerCase()).toContain("calculix");
    } else {
      const bytes = Buffer.from(await reportFetch.body());
      expect(bytes.byteLength).toBeGreaterThan(64);
      report = { artifact_bytes: bytes.byteLength };
    }
  }

  await page.reload();
  const persisted = await apiJson(request, apiBase, "GET", `/api/v1/jobs/${submitted.id}/results`, token);
  expect(persisted.status).toBe(200);
  expect(Number(persisted.json?.mesh?.nodes)).toBeGreaterThan(10);
  // Re-open the completed job in Studio Results after reload.
  await page.locator('nav[aria-label="Run steps"]').getByRole("button", { name: /Results/ }).click();
  await expect(page.getByRole("cell", { name: submitted.id.slice(0, 8) })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("cell", { name: submitted.id.slice(0, 8) }).click();
  await expect(page.getByText("Governing von Mises", { exact: true })).toBeVisible({ timeout: 60_000 });

  return { jobId: submitted.id, results, report };
}
