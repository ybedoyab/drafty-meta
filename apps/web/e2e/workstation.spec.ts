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
  await page.getByLabel("Length mm").first().fill("280");
  await expect(page.getByLabel("Length mm").first()).toHaveValue("280");
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
  await page.getByRole("tab", { name: "Jobs queue" }).click();
  await page.getByRole("cell", { name: jobId.slice(0, 8) }).click();
  await page.reload();
  await page.getByRole("tab", { name: "Jobs queue" }).click();
  await expect(page.getByText("0.5652").first()).toBeVisible();
});

test("after reload, Jobs queue must be opened before a completed job can show Results", async ({ page }) => {
  const jobId = "4f8ed6cc-7d26-4a53-ba2a-ba1569ab4933";
  const completedJob = {
    id: jobId,
    kind: "simulation",
    status: "completed",
    message: "completed",
    error: null,
    compute: "modal",
    summary: {
      mass_kg: 0.42,
      max_displacement_m: 1.3e-7,
      safety_factor: 276.2,
      validation_status: "solver_completed",
    },
    spec: null,
    created_at: "2026-11-04T15:37:55+00:00",
    updated_at: "2026-11-04T15:38:40+00:00",
    active: false,
  };
  const results = {
    units: { length: "m" },
    validation_status: "solver_completed",
    solver: { name: "calculix", version: "CalculiX", mode: "modal" },
    mesh: {
      nodes: 31795,
      elements: 18980,
      element_type: "C3D10",
      target_size_m: 0.004,
      quality: {
        element_type: "C3D10",
        elements_checked: 18980,
        jacobian_validation_method: "numpy_tet10_analytical_derivatives+selective_adaptive",
        jacobian_validation_status: "sampled_ok_certification_inconclusive",
        min_jacobian: 3.741420378864258e-9,
        max_jacobian: 4.0036956154647843e-8,
        normalized_jacobian_ratio_min: 0.9999999999998163,
        inverted_elements: 0,
        degenerate_elements: 0,
        inconclusive_elements: 18980,
        quality_warnings: ["soft ratio warning for demo"],
        certification_note:
          "certified_valid is never claimed by the NumPy path; inconclusive means no inversion was demonstrated",
      },
    },
    quality_gates: {
      solver_completed: true,
      equilibrium_verified: true,
      mesh_validity: "passed_sampled",
      mesh_quality: "reported",
      stress_assessment: "exploratory",
      validated_feasibility: false,
    },
    mass_kg: 0.42,
    max_displacement_m: 1.3e-7,
    max_von_mises_pa: 2.037e6,
    governing_von_mises_pa: 6.651e5,
    safety_factor: 276.2,
    benchmark: { applicable: false, passed: false },
    warnings: ["exploratory"],
    surface: {
      vertices_m: [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
      ],
      faces: [[0, 1, 2]],
      displacement_m: [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ],
      von_mises_pa: [1, 2, 3],
    },
    stress_assessment: {
      safety_factor_status: "exploratory",
      exclusion: "fixed face",
      exclusion_reason: "singularity",
      mesh_sensitivity: "compare meshes",
      measure: "governing",
      nodal_field: "frd",
      integration_point_field: "dat",
      displayed_surface: "corners",
    },
    equilibrium: {
      passed: true,
      applied_force_n: [0, 0, -200],
      reaction_force_n: [0, 0, 200],
      residual_n: 0,
      relative_residual: 0,
    },
  };

  await page.route("**/api/v1/health", (route) =>
    route.fulfill({
      json: {
        service: "drafty",
        solver: { available: true, mode: "docker", detail: "drafty-ccx" },
        meta: false,
        modal: false,
        supabase: false,
        auth: "disabled",
        compute: "local",
      },
    }),
  );
  await page.route("**/api/v1/materials", (route) => route.fulfill({ json: [] }));
  // Register job-detail routes before the list route so POST/GET by id are not swallowed.
  await page.route(`**/api/v1/jobs/${jobId}/results`, (route) => route.fulfill({ json: results }));
  await page.route(`**/api/v1/jobs/${jobId}/log`, (route) =>
    route.fulfill({ json: { solver: "ccx", worker: "ok" } }),
  );
  await page.route(`**/api/v1/jobs/${jobId}`, (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({ json: completedJob });
  });
  // No POST /jobs — regression uses an already-completed job inventory only.
  await page.route("**/api/v1/jobs", async (route) => {
    expect(route.request().method()).toBe("GET");
    await route.fulfill({ json: { jobs: [completedJob] } });
  });

  await page.goto("/studio");
  await expect(page.getByRole("tab", { name: "Edition tools" })).toBeVisible();
  await page.reload();
  // Default bottom panel is Edition tools — jobs table is not mounted.
  await expect(page.getByRole("tab", { name: "Edition tools" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("cell", { name: jobId.slice(0, 8) })).toHaveCount(0);

  await page.getByRole("tab", { name: /Jobs queue/ }).click();
  await expect(page.getByRole("columnheader", { name: "Job" })).toBeVisible();
  await page.getByRole("cell", { name: jobId.slice(0, 8) }).click();
  await showRunStep(page, "Results");
  await expect(page.getByText("Governing von Mises", { exact: true })).toBeVisible();
  await expect(page.getByText(/not a certified safety factor/i).first()).toBeVisible();
  await expect(page.getByTestId("quality-gates")).toBeVisible();
  await expect(page.getByTestId("mesh-quality")).toBeVisible();
  await expect(page.getByText("passed_sampled")).toBeVisible();
  await expect(page.getByText("sampled_ok_certification_inconclusive")).toBeVisible();
  await expect(page.getByText("Whole-element certification")).toBeVisible();
  await expect(page.getByTestId("mesh-certification-note")).toContainText("never claimed");
  await expect(page.getByTestId("mesh-soft-warning")).toContainText("soft ratio warning");
  await page.getByTestId("mesh-quality").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "../../docs/screenshots/studio-mesh-quality-batch10a.png" });
});

test("the bottom edition tools offer visual tools and swap with the jobs queue", async ({ page }) => {
  await page.route("**/api/v1/health", (route) =>
    route.fulfill({
      json: { service: "drafty", solver: { available: true, mode: "docker", detail: "drafty-ccx" }, meta: false, modal: false, supabase: false, auth: "disabled", compute: "local" },
    }),
  );
  await page.route("**/api/v1/jobs", (route) => route.fulfill({ json: { jobs: [] } }));
  await page.goto("/studio");
  await expect(page.getByRole("tab", { name: "Edition tools" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("columnheader", { name: "Job" })).toHaveCount(0);
  await expect(page.getByLabel("Length mm")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Select" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Scale" }).click();
  await expect(page.getByRole("button", { name: "Scale" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Rotate" }).click();
  await expect(page.getByRole("button", { name: "Rotate" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(/300\.0 x 20/)).toBeVisible();
  await expect(page.getByText(/no part selected/)).toBeVisible();
  await page.getByRole("tab", { name: "Jobs queue" }).click();
  await expect(page.getByRole("columnheader", { name: "Job" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Scale" })).toHaveCount(0);
});

test("drawing a roof proposes a sized piece and adds it to the spec sent to preview", async ({ page }) => {
  await page.route("**/api/v1/health", (route) =>
    route.fulfill({
      json: { service: "drafty", solver: { available: true, mode: "docker", detail: "drafty-ccx" }, meta: false, modal: false, supabase: false, auth: "disabled", compute: "local" },
    }),
  );
  await page.route("**/api/v1/jobs", (route) => route.fulfill({ json: { jobs: [] } }));
  let previewSpec: { additions?: { label: string; face: string; width_m: number }[] } | null = null;
  await page.route("**/api/v1/designs/preview", async (route) => {
    previewSpec = route.request().postDataJSON() as typeof previewSpec;
    await route.fulfill({ status: 500, json: { detail: "preview stubbed in this test" } });
  });
  await page.goto("/studio");
  await page.getByRole("button", { name: "Draw" }).click();
  await expect(page.getByRole("dialog", { name: "Draw a piece to add" })).toBeVisible();
  const canvas = page.getByTestId("sketch-canvas");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const { x, y, width, height } = box!;
  await page.mouse.move(x + width * 0.2, y + height * 0.8);
  await page.mouse.down();
  await page.mouse.move(x + width * 0.8, y + height * 0.8, { steps: 8 });
  await page.mouse.move(x + width * 0.5, y + height * 0.25, { steps: 8 });
  await page.mouse.move(x + width * 0.22, y + height * 0.78, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByLabel("Intention")).toHaveValue("Roof");
  await expect(page.getByRole("dialog", { name: "Draw a piece to add" }).getByLabel("Width mm")).not.toHaveValue("");
  await page.getByRole("button", { name: "Place this piece" }).click();
  await expect(page.getByText(/Placing: Roof/)).toBeVisible();
  await page.getByRole("button", { name: "Add this piece" }).click();
  await expect(page.getByText(/Roof · zmax/)).toBeVisible();
  expect(previewSpec?.additions).toHaveLength(1);
  expect(previewSpec?.additions?.[0]).toMatchObject({ label: "Roof", face: "zmax" });
  expect(previewSpec?.additions?.[0].width_m).toBeGreaterThan(0);
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
