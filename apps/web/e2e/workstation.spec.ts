import { test, expect } from "@playwright/test";

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
