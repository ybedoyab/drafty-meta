import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const beam = path.join(here, "fixtures", "beam-sketch.png");
const section = path.join(here, "fixtures", "isection-sketch.png");

test("a real Muse Spark turn reads two sketches and keeps the span unset", async ({ page }) => {
  test.skip(process.env.DRAFTY_LIVE_META !== "1", "Set DRAFTY_LIVE_META=1 to spend one Meta request.");
  test.setTimeout(120_000);
  const pageErrors: string[] = [];
  let questions = 0;
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });
  page.on("response", async (response) => {
    if (!response.url().includes("/api/v1/scenarios/") || !response.url().endsWith("/turn")) return;
    if (response.status() !== 200) {
      console.log("turn-http", response.status());
      return;
    }
    const body = await response.json();
    questions = (body.model_questions ?? []).length;
    const sources = (body.sources ?? []).map((item: { status?: string; url?: string }) => ({
      status: item.status,
      hasUrl: Boolean(item.url),
    }));
    console.log(
      JSON.stringify({
        mode: body.mode,
        model: body.model,
        usage: body.usage,
        phase: body.phase,
        span: body.inputs?.span_m ?? null,
        students: body.inputs?.student_count ?? null,
        ready3d: body.model_proposal?.ready_for_3d_simulation,
        sources,
      }),
    );
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/scenario/new");
  await expect(page.getByText("Muse Spark ready")).toBeVisible();
  await page.getByLabel("Evidence images").setInputFiles([beam, section]);
  await expect(page.getByText("beam-sketch.png")).toBeVisible();
  await expect(page.getByText("isection-sketch.png")).toBeVisible();
  await page.getByLabel("Describe the problem").fill(
    "I need an I-beam to support a classroom floor for 30 students in Colombia. Investigate relevant load references, ask me for missing engineering information, and build a preliminary structural model.",
  );
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Drafty:")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("muse-spark-1.3 · Responses API")).toBeVisible();
  await expect(page.getByText("not a valid engineering record")).toHaveCount(0);
  expect(questions).toBeGreaterThan(0);
  await expect(page.getByText("headcount is not a floor load").first()).toBeVisible();
  await expect(page.getByLabel("Span m")).toHaveValue("");
  await expect(page.getByText("3D simulation is not available").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Run 3D simulation" })).toBeDisabled();
  await expect(page.getByText("Not a measured drawing").first()).toBeVisible();
  const links = page.locator("a[href^='http']");
  const linkCount = await links.count();
  if (linkCount > 0) {
    await expect(links.first()).toBeVisible();
  }
  await page.screenshot({ path: "../../docs/screenshots/scenario-live-1440x900.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "../../docs/screenshots/scenario-live-mobile.png", fullPage: true });
  expect(pageErrors).toEqual([]);
});
