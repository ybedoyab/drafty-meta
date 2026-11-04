import { test, expect, type Page } from "@playwright/test";

async function showDesignStep(page: Page, label: string) {
  await page.locator('nav[aria-label="Design steps"]').getByRole("button", { name: new RegExp(label) }).click();
}
async function showRunStep(page: Page, label: string) {
  await page.locator('nav[aria-label="Run steps"]').getByRole("button", { name: new RegExp(label) }).click();
}

const health = {
  service: "drafty",
  solver: { available: true, mode: "docker", detail: "drafty-ccx" },
  meta: false,
  modal: false,
  supabase: false,
  auth: "disabled",
  compute: "local",
};

const batch10aResults = {
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

test("opening an existing scenario does not POST designs/preview until Preview solid", async ({ page }) => {
  const scenarioId = "abc2180d-e0e3-4ddb-87cc-da3f8ada8c7b";
  let previewPosts = 0;
  await page.route("**/api/v1/health", (route) => route.fulfill({ json: health }));
  await page.route("**/api/v1/jobs", (route) => route.fulfill({ json: { jobs: [] } }));
  await page.route("**/api/v1/materials", (route) => route.fulfill({ json: [] }));
  await page.route(`**/api/v1/scenarios/${scenarioId}`, (route) =>
    route.fulfill({
      json: {
        id: scenarioId,
        name: "Retained Batch 10A",
        studio_approval: "confirmed",
        studio_spec: {
          name: "retained-bracket",
          kind: "l_bracket",
          material_id: "aluminum_6061_t6",
          mesh_size_m: 0.004,
          element_order: 2,
          supports: [{ surface: "xmin", constraint: "encastre" }],
          loads: [
            {
              surface: "zmax",
              mode: "force",
              magnitude: 200,
              direction: { x: 0, y: 0, z: -1 },
            },
          ],
          beam: null,
          plate: null,
          bracket: { leg_x_m: 0.08, leg_z_m: 0.08, thickness_m: 0.008, width_m: 0.04 },
          holes: null,
          additions: [],
        },
        inputs: { displacement_limit_m: 0.001 },
        jobs: [],
      },
    }),
  );
  await page.route("**/api/v1/designs/preview", async (route) => {
    previewPosts += 1;
    await route.fulfill({ status: 500, json: { detail: "preview stubbed in this test" } });
  });

  await page.goto(`/studio?scenario=${scenarioId}`);
  await expect(page.getByText("Preview when you need geometry")).toBeVisible();
  await expect.poll(() => previewPosts).toBe(0);

  await page.reload();
  await expect(page.getByText("Preview when you need geometry")).toBeVisible();
  await expect.poll(() => previewPosts).toBe(0);

  await showDesignStep(page, "Loads");
  await page.getByRole("button", { name: "Preview solid" }).click();
  await expect.poll(() => previewPosts).toBe(1);
});

test("Studio Results separate mesh quality gates for Batch 10A jobs", async ({ page }) => {
  const jobId = "6066bc77-07d0-44ad-a49b-720b947d99fd";
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
    created_at: "2026-11-04T15:52:00+00:00",
    updated_at: "2026-11-04T15:53:00+00:00",
    active: false,
  };
  await page.route("**/api/v1/health", (route) => route.fulfill({ json: health }));
  await page.route("**/api/v1/materials", (route) => route.fulfill({ json: [] }));
  await page.route(`**/api/v1/jobs/${jobId}/results`, (route) => route.fulfill({ json: batch10aResults }));
  await page.route(`**/api/v1/jobs/${jobId}/log`, (route) =>
    route.fulfill({ json: { solver: "ccx", worker: "ok" } }),
  );
  await page.route(`**/api/v1/jobs/${jobId}`, (route) => route.fulfill({ json: completedJob }));
  await page.route("**/api/v1/jobs", async (route) => {
    expect(route.request().method()).toBe("GET");
    await route.fulfill({ json: { jobs: [completedJob] } });
  });

  await page.goto("/studio");
  await page.getByRole("tab", { name: /Jobs queue/ }).click();
  await page.getByRole("cell", { name: jobId.slice(0, 8) }).click();
  await showRunStep(page, "Results");
  await expect(page.getByTestId("quality-gates")).toBeVisible();
  await expect(page.getByTestId("mesh-quality")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Solver completion" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Validation gates" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Mesh quality" })).toBeVisible();
  await expect(page.getByText("passed_sampled")).toBeVisible();
  await expect(page.getByText("sampled_ok_certification_inconclusive")).toBeVisible();
  await expect(page.getByText("Whole-element certification")).toBeVisible();
  await expect(page.getByText("inconclusive", { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId("mesh-certification-note")).toContainText("never claimed");
  await expect(page.getByTestId("mesh-soft-warning")).toContainText("soft ratio warning");
  await expect(page.getByText("Engineering feasibility", { exact: true })).toBeVisible();
  await page.getByTestId("mesh-quality").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "../../docs/screenshots/studio-mesh-quality-batch10a.png" });
});

test("historical FEM results without Batch 10A fields show a legacy mesh summary", async ({ page }) => {
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
  await page.route("**/api/v1/health", (route) => route.fulfill({ json: health }));
  await page.route("**/api/v1/materials", (route) => route.fulfill({ json: [] }));
  await page.route(`**/api/v1/jobs/${jobId}/results`, (route) =>
    route.fulfill({
      json: {
        ...batch10aResults,
        mesh: {
          nodes: 31795,
          elements: 18980,
          element_type: "C3D10",
          target_size_m: 0.004,
          quality: {
            elements: 18980,
            inverted_elements: 0,
            jacobian: "positive corner-tetrahedron volume; quadratic mid-edge nodes are matched separately",
          },
        },
        quality_gates: undefined,
      },
    }),
  );
  await page.route(`**/api/v1/jobs/${jobId}/log`, (route) =>
    route.fulfill({ json: { solver: "ccx", worker: "ok" } }),
  );
  await page.route(`**/api/v1/jobs/${jobId}`, (route) => route.fulfill({ json: completedJob }));
  await page.route("**/api/v1/jobs", async (route) => {
    expect(route.request().method()).toBe("GET");
    await route.fulfill({ json: { jobs: [completedJob] } });
  });

  await page.goto("/studio");
  await page.getByRole("tab", { name: /Jobs queue/ }).click();
  await page.getByRole("cell", { name: jobId.slice(0, 8) }).click();
  await showRunStep(page, "Results");
  await expect(page.getByTestId("mesh-quality-legacy")).toBeVisible();
  await expect(page.getByText("legacy corner-volume check")).toBeVisible();
  await expect(page.getByText("Whole-element certification")).toBeVisible();
  await expect(page.getByText("unavailable", { exact: true }).first()).toBeVisible();
  await page.getByTestId("mesh-quality").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "../../docs/screenshots/studio-mesh-quality-legacy.png" });
});

test("reloading Studio restores completed results without submitting a new FEM job", async ({ page }) => {
  const jobId = "6066bc77-07d0-44ad-a49b-720b947d99fd";
  let postJobs = 0;
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
    created_at: "2026-11-04T15:52:00+00:00",
    updated_at: "2026-11-04T15:53:00+00:00",
    active: false,
  };
  await page.route("**/api/v1/health", (route) => route.fulfill({ json: health }));
  await page.route("**/api/v1/materials", (route) => route.fulfill({ json: [] }));
  await page.route(`**/api/v1/jobs/${jobId}/results`, (route) => route.fulfill({ json: batch10aResults }));
  await page.route(`**/api/v1/jobs/${jobId}/log`, (route) =>
    route.fulfill({ json: { solver: "ccx", worker: "ok" } }),
  );
  await page.route(`**/api/v1/jobs/${jobId}`, (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({ json: completedJob });
  });
  await page.route("**/api/v1/jobs", async (route) => {
    if (route.request().method() === "POST") {
      postJobs += 1;
      await route.fulfill({ status: 500, json: { detail: "no new jobs in this regression" } });
      return;
    }
    await route.fulfill({ json: { jobs: [completedJob] } });
  });

  await page.goto("/studio");
  await page.getByRole("tab", { name: /Jobs queue/ }).click();
  await page.getByRole("cell", { name: jobId.slice(0, 8) }).click();
  await showRunStep(page, "Results");
  await expect(page.getByText("sampled_ok_certification_inconclusive")).toBeVisible();

  await page.reload();
  await page.getByRole("tab", { name: /Jobs queue/ }).click();
  await page.getByRole("cell", { name: jobId.slice(0, 8) }).click();
  await showRunStep(page, "Results");
  await expect(page.getByTestId("mesh-quality")).toBeVisible();
  await expect(page.getByText("sampled_ok_certification_inconclusive")).toBeVisible();
  expect(postJobs).toBe(0);
});
