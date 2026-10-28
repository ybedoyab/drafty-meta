import { expect, test } from "@playwright/test";

test("an approved bracket runs CalculiX and one real optimization", async ({ page, request }) => {
  test.setTimeout(360_000);
  const health = await request.get("http://127.0.0.1:8000/api/v1/health");
  const body = await health.json();
  test.skip(!body.solver?.available, "CalculiX is not available on this machine.");
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/scenario/new");
  await page.getByLabel("Describe the problem").fill(
    "Design an aluminum bracket. Force 200 N. Legs 80 mm by 80 mm. Thickness 8 mm. Bracket width 40 mm. Displacement limit 1 mm.",
  );
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByLabel("Fixed face").selectOption("xmin");
  await page.getByLabel("Load face").selectOption("zmax");
  await page.getByRole("button", { name: "Confirm faces" }).click();
  await page.getByRole("button", { name: "Approve and open Studio" }).click();
  await expect(page.getByLabel("Part")).toHaveValue("l_bracket");
  await expect(page.getByLabel("Order")).toHaveValue("2");
  await page.getByRole("button", { name: "Run analysis" }).click();
  await expect(page.getByText("Governing von Mises", { exact: true })).toBeVisible({ timeout: 180_000 });
  await expect(page.getByText("This is not a certified safety factor.")).toBeVisible();
  await page.screenshot({ path: "../../docs/screenshots/bracket-calculix-1440x900.png" });
  const reportHref = await page.getByRole("link", { name: "report.json" }).getAttribute("href");
  expect(reportHref).toBeTruthy();
  const report = await page.request.get(reportHref!);
  expect(report.ok()).toBeTruthy();
  const reportBody = await report.json();
  expect(JSON.stringify(reportBody).toLowerCase()).toContain("calculix");
  await page.getByLabel("Lower mm").fill("4");
  await page.getByLabel("Iterations").fill("2");
  await page.getByRole("button", { name: "Optimize with FEM" }).click();
  await expect(page.getByText("Not a proof of a global optimum")).toBeVisible({ timeout: 180_000 });
  await expect(page.getByText("Not a certified safety factor").first()).toBeVisible();
  await page.screenshot({ path: "../../docs/screenshots/bracket-optimization-1440x900.png" });
  expect(pageErrors).toEqual([]);
});
