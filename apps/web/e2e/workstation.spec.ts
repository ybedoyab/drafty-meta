import { test, expect } from "@playwright/test";

test("the landing page opens the studio example", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Drafty" })).toBeVisible();
  await page.getByRole("link", { name: "Open the studio" }).click();
  await expect(page.getByRole("button", { name: "Load cantilever example" })).toBeVisible();
});
