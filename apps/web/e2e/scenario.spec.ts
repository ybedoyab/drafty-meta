import { expect, test } from "@playwright/test";

const png = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d763f8cfc0000000030001c7e4e3d30000000049454e44ae426082",
  "hex",
);

test("a classroom scenario asks for missing data and does not open a 3D solve", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/scenario/new");
  await expect(page.getByText("AI not connected")).toBeVisible();
  await page.getByRole("button", { name: "Use the classroom example" }).click();
  await expect(page.getByText("headcount is not a floor load").first()).toBeVisible();
  await expect(page.getByText("12500.0 N/m")).toHaveCount(0);
  await page.getByLabel("Span m").fill("6");
  await page.getByLabel("Tributary width m").fill("2.5");
  await page.getByLabel(/Dead load/).fill("3");
  await page.getByLabel("Depth mm").fill("200");
  await page.getByLabel("Flange width mm").fill("100");
  await page.getByLabel("Flange thickness mm").fill("10");
  await page.getByLabel("Web thickness mm").fill("6");
  await page.getByRole("button", { name: "Use Colombia NSR-10 classroom minimum" }).click();
  await expect(page.getByText("NSR-10 Title B, Table B.4.2.1-1").first()).toBeVisible();
  await expect(page.getByText("12500.0 N/m").first()).toBeVisible();
  await expect(page.getByText("not finite-element results").first()).toBeVisible();
  await expect(page.getByText("3D simulation is not available").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Run 3D simulation" })).toBeDisabled();
  await page.getByLabel("Supports").fill("simply supported");
  await page.getByRole("button", { name: "Run beam elements" }).click();
  await expect(page.getByRole("heading", { name: "Beam-element results" })).toBeVisible();
  await expect(page.getByText("not a certification").first()).toBeVisible();
  await expect(page.getByText("Euler-Bernoulli beam elements").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Run 3D simulation" })).toBeDisabled();
  await page.getByLabel("Span m").fill("5");
  await page.getByRole("button", { name: "Compare this edit" }).click();
  await expect(page.getByText("Edited, 5 m")).toBeVisible();
  await page.getByLabel("Evidence images").setInputFiles([
    { name: "plan.png", mimeType: "image/png", buffer: png },
    { name: "photo.png", mimeType: "image/png", buffer: png },
  ]);
  await expect(page.getByText("plan.png")).toBeVisible();
  await expect(page.getByText("photo.png")).toBeVisible();
  await page.getByRole("button", { name: "Remove" }).first().click();
  await expect(page.getByText("plan.png")).toHaveCount(0);
  await page.getByRole("heading", { name: "Beam-element results" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "../../docs/screenshots/scenario-model-1440x900.png" });
  await page.reload();
  await expect(page.getByText("12500.0 N/m").first()).toBeVisible();
  await expect(page.getByText("photo.png")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Beam-element results" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("heading", { name: "Beam-element results" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "../../docs/screenshots/scenario-model-mobile.png" });
  await page.getByRole("link", { name: "Open Studio manually" }).click();
  await expect(page.getByRole("button", { name: "Load cantilever example" })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("landing screenshots", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/");
  await page.screenshot({ path: "../../docs/screenshots/landing-1366x768.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: "../../docs/screenshots/landing-1440x900.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "../../docs/screenshots/landing-mobile.png", fullPage: true });
});
