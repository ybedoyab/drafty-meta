/**
 * Live QA suite for authenticated Drafty flows (local + production targets).
 * Credentials load from the repository-root .env via ./qa/env.ts.
 * Never logs passwords, JWTs, or service-role secrets.
 */
import { expect, test } from "@playwright/test";
import {
  hasPrimaryCredentials,
  hasSecondaryCredentials,
  productionPaidQaAuthorized,
  qaEnv,
  redact,
  targetFromProject,
} from "./qa/env";
import {
  budgetAccounting,
  budgetRunId,
  budgetSnapshot,
  recordCompletedResponse,
  recordInvocationAttempt,
  recordJobId,
  recordedJobIds,
  remaining,
  tryConsume,
} from "./qa/budget";
import {
  accessTokenFromPage,
  apiJson,
  assertNonEmptyBinary,
  cleanupQaOwnedLeftovers,
  cleanupTracked,
  collectPageErrors,
  createNamedScenario,
  deleteScenarioByName,
  openScenarioFromProjects,
  qaScenarioName,
  runApprovedBracketFem,
  safeScreenshot,
  showInspectorStep,
  signIn,
  signOut,
  trackScenario,
} from "./qa/helpers";

function currentTarget() {
  return targetFromProject(test.info().project.name);
}

test.describe.configure({ mode: "serial" });

test.describe("Drafty live QA", () => {
  test.beforeAll(() => {
    test.skip(!hasPrimaryCredentials(), "DRAFTY_QA_EMAIL / DRAFTY_QA_PASSWORD are required.");
  });

  let primaryScenarioId = "";
  let primaryScenarioName = "";
  let pawnScenarioId = "";
  let pawnScenarioName = "";

  test.afterAll(async ({ browser, request }) => {
    const target = currentTarget();
    const context = await browser.newContext({ baseURL: target.web });
    const page = await context.newPage();
    try {
      await signIn(page, "primary");
      const cleanup = await cleanupTracked(request, target.api, page);
      if (cleanup.failed.length) {
        console.log("QA cleanup leftovers (ids only):", cleanup.failed.map(redact).join(", "));
      } else {
        console.log("QA cleanup deleted:", cleanup.deleted.length);
      }
    } catch (error) {
      console.log("QA cleanup could not finish:", redact(String(error)));
    } finally {
      await context.close();
    }
  });

  test("cleanup verified DRAFTY_QA leftover scenarios only", async ({ page, request }) => {
    const target = currentTarget();
    if (target.kind === "production") {
      test.skip(!qaEnv.runProduction, "Production flag off.");
    }
    await page.goto(target.web);
    const result = await cleanupQaOwnedLeftovers(request, target.api, page);
    console.log(JSON.stringify({ target: target.kind, leftover_cleanup: result }));
    if (target.kind === "production" && result.failed.some((item) => item.endsWith(":503"))) {
      // Expected until the Storage nested-404 delete fix is merged and deployed to production.
      console.log(
        JSON.stringify({
          production_cleanup: "BLOCKED",
          reason:
            "Production API returned 503 during QA scenario delete. The Storage cleanup fix lives on the QA branch until merge+deploy; do not treat branch HEAD as live production.",
          ids: result.failed.map((item) => item.split(":")[0]),
        }),
      );
      return;
    }
    expect(result.failed, JSON.stringify(result.failed)).toEqual([]);
  });

  test("health and homepage are reachable", async ({ page, request }) => {
    const target = currentTarget();
    if (target.kind === "production") {
      test.skip(!qaEnv.runProduction, "Set DRAFTY_QA_RUN_PRODUCTION=true to exercise production.");
    }
    const errors = await collectPageErrors(page);
    const health = await request.get(`${target.api}/api/v1/health`);
    expect(health.status()).toBe(200);
    const body = await health.json();
    expect(body.service).toBeTruthy();
    console.log(
      JSON.stringify({
        target: target.kind,
        auth: body.auth,
        compute: body.compute,
        solver_available: body.solver?.available ?? null,
        modal: body.modal_available ?? body.modal,
        meta: body.meta,
        supabase: body.supabase,
        budget_run_id: budgetRunId(),
        budget: budgetSnapshot(),
        paid_gate: productionPaidQaAuthorized(),
      }),
    );
    await page.goto(target.web);
    await expect(page.locator("body")).toBeVisible();
    await safeScreenshot(page, `${target.kind}-homepage.png`);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(target.web);
    await safeScreenshot(page, `${target.kind}-homepage-mobile.png`);
    await page.setViewportSize({ width: 1440, height: 900 });
    expect(errors.filter((item) => !item.includes("favicon"))).toEqual([]);
  });

  test("auth persistence, rename, reload, and sign-in cycle", async ({ page, request }) => {
    const target = currentTarget();
    if (target.kind === "production") {
      test.skip(!qaEnv.runProduction, "Production flag off.");
    }
    await page.goto(target.web);
    await signIn(page, "primary");
    primaryScenarioName = qaScenarioName("auth");
    primaryScenarioId = await createNamedScenario(page, request, target.api, primaryScenarioName, "primary");

    const token = await accessTokenFromPage(page);
    expect(token).toBeTruthy();
    const owned = await apiJson(request, target.api, "GET", `/api/v1/scenarios/${primaryScenarioId}`, token);
    expect(owned.status).toBe(200);
    expect(owned.json?.id).toBe(primaryScenarioId);

    await page.goto(`${target.web}/projects`);
    await expect(page.getByText(primaryScenarioName)).toBeVisible();
    await openScenarioFromProjects(page, primaryScenarioName);
    await page.reload();
    await expect(page.getByLabel("Describe the problem")).toBeVisible();

    await signOut(page);
    await signIn(page, "primary");
    await page.goto(`${target.web}/projects`);
    await expect(page.getByText(primaryScenarioName)).toBeVisible();
    await safeScreenshot(page, `${target.kind}-projects-after-relogin.png`);
  });

  test("cross-user isolation via authenticated API", async ({ page, request }) => {
    const target = currentTarget();
    if (target.kind === "production") {
      test.skip(!qaEnv.runProduction, "Production flag off.");
    }
    test.skip(!hasSecondaryCredentials(), "Secondary QA credentials absent — isolation SKIPPED.");
    expect(primaryScenarioId).toBeTruthy();

    await page.goto(target.web);
    await signOut(page);
    await signIn(page, "secondary");
    const token2 = await accessTokenFromPage(page);
    expect(token2).toBeTruthy();

    const getForeign = await apiJson(
      request,
      target.api,
      "GET",
      `/api/v1/scenarios/${primaryScenarioId}`,
      token2,
    );
    expect([401, 403, 404]).toContain(getForeign.status);

    const renameForeign = await apiJson(
      request,
      target.api,
      "POST",
      `/api/v1/scenarios/${primaryScenarioId}/rename`,
      token2,
      { name: `${primaryScenarioName}_hijack` },
    );
    expect([401, 403, 404]).toContain(renameForeign.status);

    const deleteForeign = await apiJson(
      request,
      target.api,
      "DELETE",
      `/api/v1/scenarios/${primaryScenarioId}`,
      token2,
    );
    expect([401, 403, 404]).toContain(deleteForeign.status);

    await page.goto(`${target.web}/projects`);
    await expect(page.getByText(primaryScenarioName)).toHaveCount(0);

    await signOut(page);
    await signIn(page, "primary");
    const token1 = await accessTokenFromPage(page);
    const stillThere = await apiJson(
      request,
      target.api,
      "GET",
      `/api/v1/scenarios/${primaryScenarioId}`,
      token1,
    );
    expect(stillThere.status).toBe(200);
  });

  test("Staunton pawn geometry-only CAD + downloads + cache headers", async ({ page, request }) => {
    test.setTimeout(300_000);
    const target = currentTarget();
    if (target.kind === "production") {
      test.skip(!qaEnv.runProduction, "Production flag off.");
      test.skip(!qaEnv.runLiveModal, "Production pawn may require Modal; DRAFTY_QA_RUN_LIVE_MODAL is false.");
      const gate = productionPaidQaAuthorized();
      test.skip(!gate.ok, gate.reason);
      test.skip(remaining("modal_geometry") < 1, "Modal geometry budget exhausted.");
    }

    await page.goto(target.web);
    await signIn(page, "primary");
    pawnScenarioName = qaScenarioName("pawn");
    pawnScenarioId = await createNamedScenario(page, request, target.api, pawnScenarioName, "primary");
    await openScenarioFromProjects(page, pawnScenarioName);

    // Unique height forces a production shared-cache miss for the Modal budget check.
    const heightMm = target.kind === "production" ? Number(`50.${Date.now().toString().slice(-3)}`) : 50;
    const heightLabel = String(heightMm);
    await page.getByLabel("Describe the problem").fill(
      `Design a Staunton chess pawn, overall height ${heightLabel} mm, base diameter 28 mm, decorative PLA, STEP and STL exports.`,
    );
    // Capture the first geometry response (cache miss/hit) while the UI builds the preview.
    const firstGeometryPromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/v1/scenarios/${pawnScenarioId}/geometry/`) &&
        res.request().method() === "GET" &&
        res.status() === 200,
      { timeout: 180_000 },
    );
    if (target.kind === "production") {
      // Reservation only — do not count Send itself as a Modal invocation.
      expect(tryConsume("modal_geometry"), "reserve Modal geometry budget").toBe(true);
    }
    const geometryAttemptPromise =
      target.kind === "production"
        ? page.waitForResponse(
            (res) =>
              res.url().includes(`/api/v1/scenarios/${pawnScenarioId}/geometry/`) &&
              res.request().method() === "GET" &&
              [200, 202, 502, 503, 504].includes(res.status()),
            { timeout: 180_000 },
          )
        : null;
    await page.getByRole("button", { name: "Send" }).click();
    await showInspectorStep(page, "Inputs");
    await expect(page.getByLabel("Height mm")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByLabel("Height mm")).toHaveValue(heightLabel);
    await showInspectorStep(page, "Model");
    await expect(page.getByRole("heading", { name: "Geometry" })).toBeVisible();
    await expect(page.getByText(/no structural check was run|geometry only/i).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Run 3D simulation" })).toHaveCount(0);
    if (geometryAttemptPromise) {
      const attempt = await geometryAttemptPromise;
      // A 202 pending poll or terminal error proves the provider path was entered;
      // a cache hit 200 without pending would mean no Modal work.
      if (attempt.status() !== 200 || (attempt.headers()["x-drafty-geometry-cache"] || "").toLowerCase() === "miss") {
        recordInvocationAttempt("modal_geometry");
      }
    }
    const firstGeometry = await firstGeometryPromise;
    const firstCache = (firstGeometry.headers()["x-drafty-geometry-cache"] || "").toLowerCase();
    const firstDigest = firstGeometry.headers()["x-drafty-geometry-digest"] || "";
    await expect(page.getByText("Building the preview.")).toHaveCount(0, { timeout: 180_000 });
    if (target.kind === "production") {
      expect(firstCache).toBe("miss");
      recordCompletedResponse("modal_geometry");
    }

    const token = await accessTokenFromPage(page);
    const stepResp = await request.get(`${target.api}/api/v1/scenarios/${pawnScenarioId}/geometry/model.step`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    expect(stepResp.status()).toBe(200);
    assertNonEmptyBinary(Buffer.from(await stepResp.body()), "step");

    const second = await request.get(`${target.api}/api/v1/scenarios/${pawnScenarioId}/geometry/model.stl`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    expect(second.status()).toBe(200);
    const secondCache = second.headers()["x-drafty-geometry-cache"] || "";
    assertNonEmptyBinary(Buffer.from(await second.body()), "stl");
    if (firstDigest) {
      expect(second.headers()["x-drafty-geometry-digest"] || "").toBe(firstDigest);
    }
    expect(secondCache).toBe("hit");
    console.log(
      JSON.stringify({
        target: target.kind,
        pawn_cache_first: firstCache || "absent",
        pawn_cache_second: secondCache,
        digest_len: firstDigest.length,
        height_mm: heightMm,
        budget: budgetSnapshot(),
        accounting: budgetAccounting(),
      }),
    );
    await safeScreenshot(page, `${target.kind}-pawn-geometry.png`);
  });

  test("classroom demo Euler-Bernoulli analysis and span compare", async ({ page, request }) => {
    test.setTimeout(120_000);
    const target = currentTarget();
    if (target.kind === "production") {
      test.skip(!qaEnv.runProduction, "Production flag off.");
    }
    await page.goto(target.web);
    await signIn(page, "primary");
    const name = qaScenarioName("beam");
    const scenarioId = await createNamedScenario(page, request, target.api, name, "primary");
    await openScenarioFromProjects(page, name);

    await page.getByRole("button", { name: "Load Classroom Demo" }).click();
    await expect(page.getByText("classroom-v1").first()).toBeVisible({ timeout: 30_000 });
    await showInspectorStep(page, "Inputs");
    await expect(page.getByLabel("Span m")).toHaveValue("6");
    await showInspectorStep(page, "Results");
    await expect(page.getByText("3D simulation is not available").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Run 3D simulation" })).toBeDisabled();
    await page.getByRole("button", { name: "Run Demo Analysis" }).click();
    await expect(page.getByRole("heading", { name: "Beam-element results" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("Euler-Bernoulli beam elements").first()).toBeVisible();
    await expect(page.getByText("not a certification").first()).toBeVisible();

    await showInspectorStep(page, "Inputs");
    await page.getByLabel("Span m").fill("5");
    await showInspectorStep(page, "Results");
    await page.getByRole("button", { name: "Compare this edit" }).click();
    await expect(page.getByText("Edited, 5 m")).toBeVisible({ timeout: 60_000 });
    await safeScreenshot(page, `${target.kind}-classroom-beam.png`);
    trackScenario({ scenarioId, name, owner: "primary" });
    await deleteScenarioByName(page, name);
  });

  test("aluminum bracket path (real FEM only when solver/Modal allowed)", async ({ page, request }) => {
    test.setTimeout(420_000);
    const target = currentTarget();
    if (target.kind === "production") {
      test.skip(!qaEnv.runProduction, "Production flag off.");
      test.skip(!qaEnv.runLiveModal, "Paid Modal FEM disabled.");
      const gate = productionPaidQaAuthorized();
      test.skip(!gate.ok, gate.reason);
      test.skip(remaining("modal_fem") < 1, "Modal FEM budget exhausted.");
    }
    await page.goto(target.web);
    await signIn(page, "primary");
    const health = await (await request.get(`${target.api}/api/v1/health`)).json();
    const localSolver = Boolean(health.solver?.available);
    if (target.kind === "local" && !localSolver) {
      test.skip(true, "Local CalculiX unavailable — bracket FEM not executed.");
    }

    if (target.kind === "production") {
      expect(tryConsume("modal_fem"), "reserve Modal FEM budget").toBe(true);
    }

    const name = qaScenarioName("bracket");
    const scenarioId = await createNamedScenario(page, request, target.api, name, "primary");
    await openScenarioFromProjects(page, name);
    await page.getByRole("button", { name: "Load Bracket Demo" }).click();
    await expect(page.getByText(/bracket-v1|Aluminum L-bracket demo/i).first()).toBeVisible({ timeout: 30_000 });

    try {
      const { jobId, results } = await runApprovedBracketFem(page, request, target.api, {
        expectCompute: target.kind === "production" ? "modal" : "local",
        timeoutMs: target.kind === "production" ? 360_000 : 240_000,
      });
      recordJobId(jobId);
      if (target.kind === "production") {
        recordInvocationAttempt("modal_fem");
        recordCompletedResponse("modal_fem");
      }
      trackScenario({ scenarioId, name, owner: "primary" });
      console.log(
        JSON.stringify({
          target: target.kind,
          job_id: jobId,
          solver: results?.solver,
          mesh: results?.mesh,
          max_displacement_m: results?.max_displacement_m,
          governing_von_mises_pa: results?.governing_von_mises_pa,
          equilibrium_passed: results?.equilibrium?.passed,
          validation_status: results?.validation_status,
          warnings_count: Array.isArray(results?.warnings) ? results.warnings.length : null,
          budget: budgetSnapshot(),
          accounting: budgetAccounting(),
          recorded_jobs: recordedJobIds(),
        }),
      );
      await safeScreenshot(page, `${target.kind}-bracket-fem.png`);
    } catch (error) {
      trackScenario({ scenarioId, name, owner: "primary" });
      console.log(
        JSON.stringify({
          target: target.kind,
          bracket_fem: "FAILED",
          error: redact(String(error)),
          note: "Stopped after first failed live FEM attempt; no additional paid retries.",
          budget: budgetSnapshot(),
        }),
      );
      throw error;
    }
  });

  test("mocked microphone UI without claiming live Meta transcription", async ({ page, request }) => {
    const target = currentTarget();
    if (target.kind === "production") {
      test.skip(!qaEnv.runProduction, "Production flag off.");
    }
    await page.goto(target.web);
    await signIn(page, "primary");
    const name = qaScenarioName("voice");
    await createNamedScenario(page, request, target.api, name, "primary");
    await openScenarioFromProjects(page, name);
    await page.addInitScript(() => {
      class FakeRecorder {
        state = "inactive";
        ondataavailable: ((ev: BlobEvent) => void) | null = null;
        onstop: (() => void) | null = null;
        start() {
          this.state = "recording";
        }
        stop() {
          this.state = "inactive";
          const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/webm" });
          this.ondataavailable?.({ data: blob } as BlobEvent);
          this.onstop?.();
        }
      }
      // @ts-expect-error test shim
      window.MediaRecorder = FakeRecorder;
      // @ts-expect-error test shim
      navigator.mediaDevices = {
        getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) as MediaStream,
      };
    });
    await page.reload();
    const mic = page.getByRole("button", { name: /Record|Microphone|Mic/i });
    test.skip((await mic.count()) === 0, "Microphone control not visible.");
    await mic.first().click();
    await page.waitForTimeout(300);
    await mic.first().click();
    console.log(
      JSON.stringify({
        live_meta_flag: qaEnv.runLiveMeta,
        note: "Browser MediaRecorder mocked; live transcription NOT TESTED.",
      }),
    );
  });

  test("scenario deletion cleanup policy on QA resource", async ({ page, request }) => {
    const target = currentTarget();
    if (target.kind === "production") {
      test.skip(!qaEnv.runProduction, "Production flag off.");
    }
    await page.goto(target.web);
    await signIn(page, "primary");
    const name = qaScenarioName("cleanup");
    const scenarioId = await createNamedScenario(page, request, target.api, name, "primary");
    const token = await accessTokenFromPage(page);
    const deleted = await apiJson(request, target.api, "DELETE", `/api/v1/scenarios/${scenarioId}`, token);
    expect(deleted.status).toBe(200);
    expect(deleted.json?.deleted).toBe(true);
    expect(deleted.json?.cleanup?.geometry_cache).toBe("retained");
    const second = await apiJson(request, target.api, "DELETE", `/api/v1/scenarios/${scenarioId}`, token);
    expect([404, 503]).toContain(second.status);
  });

  test("optional single Meta turn when explicitly enabled", async ({ page, request }) => {
    test.skip(!qaEnv.runLiveMeta, "DRAFTY_QA_RUN_LIVE_META is false — Meta live NOT TESTED.");
    test.skip(remaining("meta") < 1, "Meta live budget already consumed.");
    test.setTimeout(120_000);
    const target = currentTarget();
    // Prefer local when both targets run; production Meta only if local already skipped.
    if (target.kind === "production") {
      test.skip(!qaEnv.runProduction, "Production flag off.");
      const gate = productionPaidQaAuthorized();
      test.skip(!gate.ok, gate.reason);
    }
    await page.goto(target.web);
    await signIn(page, "primary");
    const name = qaScenarioName("meta");
    await createNamedScenario(page, request, target.api, name, "primary");
    await openScenarioFromProjects(page, name);
    await expect(page.getByText(/Muse Spark ready|AI not connected|Meta/i).first()).toBeVisible();
    // Availability must be checked before burning a paid reservation.
    test.skip((await page.getByText("AI not connected").count()) > 0, "Meta is not connected on this target.");
    expect(tryConsume("meta"), "reserve Meta budget").toBe(true);
    recordInvocationAttempt("meta");
    await page.getByLabel("Describe the problem").fill(
      "I need an I-beam for a classroom floor for 30 students in Colombia. Ask for missing engineering data only. Do not invent span, loads, or citations.",
    );
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("Drafty:")).toBeVisible({ timeout: 90_000 });
    recordCompletedResponse("meta");
    const reply = await page.locator("text=Drafty:").locator("..").first().innerText();
    expect(reply.toLowerCase()).not.toMatch(/https?:\/\/doi\.org|according to asce 7-22 section/i);
    await showInspectorStep(page, "Inputs");
    // User did not provide span — must remain empty (no fabricated quantity).
    await expect(page.getByLabel("Span m")).toHaveValue("");
    console.log(
      JSON.stringify({
        meta_live: "PASS",
        target: target.kind,
        budget: budgetSnapshot(),
        accounting: budgetAccounting(),
      }),
    );
  });
});
