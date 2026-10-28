import { expect, test } from "@playwright/test";

const png = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d763f8cfc0000000030001c7e4e3d30000000049454e44ae426082",
  "hex",
);

test("the classroom template stays a brief when the solid solver cannot represent it", async ({ page }) => {
  await page.goto("/scenario/new");
  await expect(page.getByText("AI not connected")).toBeVisible();
  await page.getByRole("button", { name: "Use the classroom beam template" }).click();
  await page.getByRole("button", { name: "2. Evidence" }).click();
  await page.getByLabel("Evidence images").setInputFiles([
    { name: "plan.png", mimeType: "image/png", buffer: png },
    { name: "photo.png", mimeType: "image/png", buffer: png },
  ]);
  await expect(page.getByText("plan.png")).toBeVisible();
  await expect(page.getByText("photo.png")).toBeVisible();
  await page.getByRole("button", { name: "Remove" }).first().click();
  await expect(page.getByText("plan.png")).toHaveCount(0);
  await page.getByRole("button", { name: "3. Clarify" }).click();
  await page.getByLabel("Tributary width m").fill("");
  await page.getByRole("button", { name: "5. Model" }).click();
  await expect(page.getByText("Tributary width is still missing")).toBeVisible();
  await page.getByRole("button", { name: "3. Clarify" }).click();
  await page.getByLabel("Span m").fill("6");
  await page.getByLabel("Tributary width m").fill("2.5");
  await page.getByLabel(/Dead load/).fill("3");
  await page.getByRole("button", { name: "4. Research" }).click();
  await expect(page.getByText("NSR-10 Title B, Table B.4.2.1-1")).toBeVisible();
  await expect(page.getByText("No web search ran")).toBeVisible();
  await page.getByRole("button", { name: "5. Model" }).click();
  await expect(page.getByText("12500.0 N/m")).toBeVisible();
  await page.getByRole("button", { name: "6. Brief" }).click();
  await expect(page.getByText("3D simulation is not available")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Studio manually" }).first()).toBeVisible();
});

for (const [name, size] of [
  ["1366x768", { width: 1366, height: 768 }],
  ["1440x900", { width: 1440, height: 900 }],
  ["mobile", { width: 390, height: 844 }],
] as const) {
  test(`scenario brief at ${name}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto("/scenario/new");
    await page.getByRole("button", { name: "Use the classroom beam template" }).click();
    await page.getByRole("button", { name: "6. Brief" }).click();
    await page.screenshot({ path: `../../docs/screenshots/scenario-brief-${name}.png`, fullPage: true });
    await page.goto("/");
    await page.screenshot({ path: `../../docs/screenshots/landing-${name}.png`, fullPage: true });
  });
}
