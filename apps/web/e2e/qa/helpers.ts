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

export type TrackedResource = {
  scenarioId: string;
  name: string;
  owner: "primary" | "secondary";
};

const tracked: TrackedResource[] = [];

export function trackedResources(): TrackedResource[] {
  return [...tracked];
}

export function trackScenario(resource: TrackedResource): void {
  if (!tracked.some((item) => item.scenarioId === resource.scenarioId)) {
    tracked.push(resource);
  }
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
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/projects/, { timeout: 45_000 });
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
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
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key) continue;
      const raw = localStorage.getItem(key);
      if (!raw || !raw.includes("access_token")) continue;
      try {
        const parsed = JSON.parse(raw) as {
          access_token?: string;
          currentSession?: { access_token?: string };
        };
        if (parsed.access_token) return parsed.access_token;
        if (parsed.currentSession?.access_token) return parsed.currentSession.access_token;
      } catch {
        // keep scanning
      }
    }
    return null;
  });
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
  const created = page.waitForResponse(
    (res) =>
      res.url().includes("/api/v1/scenarios") &&
      !res.url().includes("/turn") &&
      !res.url().includes("/demo") &&
      res.request().method() === "POST" &&
      res.status() < 400,
    { timeout: 45_000 },
  );
  await page.goto("/scenario/new");
  const response = await created;
  const body = (await response.json()) as { id: string };
  const scenarioId = body.id;
  expect(scenarioId).toBeTruthy();
  const token = await accessTokenFromPage(page);
  const renamed = await apiJson(request, apiBase, "POST", `/api/v1/scenarios/${scenarioId}/rename`, token, {
    name,
  });
  expect(renamed.status, redact(JSON.stringify(renamed.json))).toBeLessThan(400);
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
  for (const item of [...tracked].reverse()) {
    try {
      const result = await apiJson(request, apiBase, "DELETE", `/api/v1/scenarios/${item.scenarioId}`, token);
      if (result.status < 400 || result.status === 404) deleted.push(item.scenarioId);
      else failed.push(`${item.scenarioId}:${result.status}`);
    } catch (error) {
      failed.push(`${item.scenarioId}:${redact(String(error))}`);
    }
  }
  tracked.length = 0;
  if (failed.length) {
    ensureScreenshotDir();
    fs.writeFileSync(
      path.join(SCREENSHOT_DIR, "cleanup-leftovers.json"),
      JSON.stringify({ failed, at: new Date().toISOString() }, null, 2),
    );
  }
  return { deleted, failed };
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
