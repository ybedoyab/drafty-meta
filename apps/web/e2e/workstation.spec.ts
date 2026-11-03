import { test, expect, type Page } from "@playwright/test";

async function showDesignStep(page: Page, label: string) {
  await page.locator('nav[aria-label="Design steps"]').getByRole("button", { name: new RegExp(label) }).click();
}
async function showRunStep(page: Page, label: string) {
  await page.locator('nav[aria-label="Run steps"]').getByRole("button", { name: new RegExp(label) }).click();
}

test("the landing page opens the studio example", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Describe the problem/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Start with AI" })).toBeVisible();
  await page.getByRole("link", { name: "Open Studio" }).click();
  await expect(page.getByRole("button", { name: "Load cantilever example" })).toBeVisible();
  await page.getByLabel("Length mm").fill("280");
  await expect(page.getByLabel("Length mm")).toHaveValue("280");
  await expect(page.getByText(/AI not connected|Meta on/)).toBeVisible();
});

test("a mocked job can be submitted, reopened, and cancelled", async ({ page }) => {
  const jobId = "11111111-1111-4111-8111-111111111111";
  let polls = 0;
  const job = (status: string, active: boolean) => ({
    id: jobId,
    kind: "simulation",
    status,
    message: status,
    error: null,
    summary: status === "completed" ? { mass_kg: 0.5652, max_displacement_m: 0.00148, safety_factor: 4, validation_status: "benchmark_passed" } : null,
    spec: null,
    created_at: "2026-10-28T00:00:00+00:00",
    updated_at: "2026-10-28T00:00:00+00:00",
    active,
  });
  await page.route("**/api/v1/health", (route) =>
    route.fulfill({
      json: { service: "drafty", solver: { available: true, mode: "docker", detail: "drafty-ccx" }, meta: false, modal: false, supabase: false, auth: "disabled", compute: "local" },
    }),
  );
  await page.route("**/api/v1/jobs", async (route) => {
    if (route.request().method() === "POST") await route.fulfill({ json: job("queued", true) });
    else await route.fulfill({ json: { jobs: [job("completed", false)] } });
  });
  await page.route(`**/api/v1/jobs/${jobId}`, async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ json: job("cancelled", false) });
      return;
    }
    polls += 1;
    await route.fulfill({ json: job(polls > 1 ? "completed" : "solving", polls <= 1) });
  });
  await page.route(`**/api/v1/jobs/${jobId}/results`, (route) =>
    route.fulfill({
      json: {
        units: { length: "m" },
        validation_status: "benchmark_passed",
        solver: { name: "calculix", version: "CalculiX test", mode: "docker" },
        mesh: { nodes: 10, elements: 4, element_type: "C3D10", target_size_m: 0.006 },
        mass_kg: 0.5652,
        max_displacement_m: 0.00148,
        max_von_mises_pa: 6.2e7,
        governing_von_mises_pa: 5.8e7,
        safety_factor: 4,
        benchmark: { applicable: true, passed: true },
        warnings: ["exploratory"],
        surface: { vertices_m: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], faces: [[0, 1, 2]], displacement_m: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], von_mises_pa: [1, 2, 3] },
        stress_assessment: { safety_factor_status: "exploratory", exclusion: "1.5 depths", exclusion_reason: "singularity", mesh_sensitivity: "compare meshes", measure: "governing", nodal_field: "frd", integration_point_field: "dat", displayed_surface: "corners" },
        equilibrium: { passed: true, applied_force_n: [0, 0, -100], reaction_force_n: [0, 0, 100], residual_n: 0, relative_residual: 0 },
      },
    }),
  );
  await page.route(`**/api/v1/jobs/${jobId}/log`, (route) => route.fulfill({ json: { solver: "ccx", worker: "ok" } }));
  await page.goto("/studio");
  await page.getByRole("button", { name: "Run analysis" }).click();
  await expect(page.getByText("benchmark_passed")).toBeVisible();
  await expect(page.getByText("Fixed support")).toBeVisible();
  await expect(page.getByText("100 N −Z")).toBeVisible();
  await page.screenshot({ path: "../../docs/screenshots/studio-mocked-result.png" });
  await page.getByRole("cell", { name: jobId.slice(0, 8) }).click();
  await page.reload();
  await expect(page.getByText("0.5652").first()).toBeVisible();
});

test("the studio panels show one step at a time and paginate through them", async ({ page }) => {
  await page.goto("/studio");
  await expect(page.getByRole("heading", { name: "Part", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Loads" })).toHaveCount(0);
  await expect(page.getByText("What the part is: shape, size, and material.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Capabilities" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Projects" })).toBeVisible();
  await expect(page.locator('nav[aria-label="Primary"] a[href="/capabilities"] svg')).toBeVisible();
  await showDesignStep(page, "Loads");
  await expect(page.getByRole("heading", { name: "Loads" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Part", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Support")).toBeVisible();
  await page.locator('nav[aria-label="Design pagination"]').getByRole("button", { name: /Next/ }).click();
  await expect(page.getByRole("heading", { name: "Assistant" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Loads" })).toHaveCount(0);
  await page.locator('nav[aria-label="Design pagination"]').getByRole("button", { name: /Loads/ }).click();
  await expect(page.getByRole("heading", { name: "Loads" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Run", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run analysis" })).toBeVisible();
  await showRunStep(page, "Results");
  await expect(page.getByRole("heading", { name: "Results" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Run", exact: true })).toHaveCount(0);
  await expect(page.getByText("No result yet. Run an analysis first, then come back here.")).toBeVisible();
  await page.locator('nav[aria-label="Run pagination"]').getByRole("button", { name: /Next/ }).click();
  await expect(page.getByRole("heading", { name: "View" })).toBeVisible();
  await showRunStep(page, "Optimize");
  await expect(page.getByRole("heading", { name: "Optimize" })).toBeVisible();
  await expect(page.getByText("Last step")).toBeVisible();
  const runStepWidths = await page.locator('nav[aria-label="Run steps"] button').evaluateAll((buttons) =>
    buttons.map((button) => Math.round(button.getBoundingClientRect().width)),
  );
  expect(Math.max(...runStepWidths) - Math.min(...runStepWidths)).toBeLessThanOrEqual(1);
  const footerWidths = await page.locator('nav[aria-label="Run pagination"] button').evaluateAll((buttons) =>
    buttons.map((button) => Math.round(button.getBoundingClientRect().width)),
  );
  expect(footerWidths).toHaveLength(2);
  expect(Math.abs(footerWidths[0] - footerWidths[1])).toBeLessThanOrEqual(1);
});
