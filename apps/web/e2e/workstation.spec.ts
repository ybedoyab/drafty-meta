import { test, expect } from "@playwright/test";

test("the workstation heading is visible", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Drafty" })).toBeVisible();
});
