import { expect, test, type Page } from "@playwright/test";

async function showInspectorStep(page: Page, label: string) {
  await page.locator('nav[aria-label="Inspector steps"]').getByRole("button", { name: new RegExp(label) }).click();
}

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
  await page.getByRole("button", { name: "Load Classroom Demo" }).click();
  await expect(page.getByText("classroom-v1").first()).toBeVisible();
  await showInspectorStep(page, "Inputs");
  await expect(page.getByText("30 students").first()).toBeVisible();
  await expect(page.getByLabel("Span m")).toHaveValue("6");
  await expect(page.getByLabel("Tributary width m")).toHaveValue("2.5");
  await expect(page.getByLabel(/Dead load/)).toHaveValue("3");
  await expect(page.getByLabel(/Live load/)).toHaveValue("2");
  await expect(page.getByLabel("Beam self-weight N/m")).toHaveValue("0");
  await expect(page.getByLabel("Depth mm")).toHaveValue("200");
  await expect(page.getByLabel("Flange width mm")).toHaveValue("100");
  await expect(page.getByLabel("Flange thickness mm")).toHaveValue("10");
  await expect(page.getByLabel("Web thickness mm")).toHaveValue("6");
  await expect(page.getByLabel("Supports")).toHaveValue("simply supported");
  await expect(page.getByLabel("Jurisdiction")).toHaveValue("Colombia");
  await showInspectorStep(page, "Basis");
  await expect(page.getByText("NSR-10 Title B, Table B.4.2.1-1").first()).toBeVisible();
  await showInspectorStep(page, "Load path");
  await expect(page.getByText("12500.0 N/m").first()).toBeVisible();
  await expect(page.getByText("not a finite-element result").first()).toBeVisible();
  await showInspectorStep(page, "Results");
  await expect(page.getByText("3D simulation is not available").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Run 3D simulation" })).toBeDisabled();
  await page.getByRole("button", { name: "Run Demo Analysis" }).click();
  await expect(page.getByRole("heading", { name: "Beam-element results" })).toBeVisible();
  await expect(page.getByText("not a certification").first()).toBeVisible();
  await expect(page.getByText("Euler-Bernoulli beam elements").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Run 3D simulation" })).toBeDisabled();
  await showInspectorStep(page, "Inputs");
  await page.getByLabel("Span m").fill("5");
  await showInspectorStep(page, "Results");
  await page.getByRole("button", { name: "Compare this edit" }).click();
  await expect(page.getByText("Edited, 5 m")).toBeVisible();
  await showInspectorStep(page, "Evidence");
  await page.getByLabel("Evidence images").setInputFiles([
    { name: "plan.png", mimeType: "image/png", buffer: png },
    { name: "photo.png", mimeType: "image/png", buffer: png },
  ]);
  await expect(page.getByText("plan.png")).toBeVisible();
  await expect(page.getByText("photo.png")).toBeVisible();
  await page.getByRole("button", { name: "Remove" }).first().click();
  await expect(page.getByText("plan.png")).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator("aside").last().evaluate((node) => {
    node.scrollTop = 0;
  });
  await page.screenshot({ path: "../../docs/screenshots/scenario-workspace-1440x900.png" });
  await showInspectorStep(page, "Results");
  await page.getByRole("heading", { name: "Beam-element results" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "../../docs/screenshots/scenario-model-1440x900.png" });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.screenshot({ path: "../../docs/screenshots/scenario-model-1366x768.png" });
  await page.reload();
  await expect(page.getByText("12500.0 N/m").first()).toBeVisible();
  await showInspectorStep(page, "Evidence");
  await expect(page.getByText("photo.png")).toBeVisible();
  await showInspectorStep(page, "Results");
  await expect(page.getByRole("heading", { name: "Beam-element results" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("heading", { name: "Beam-element results" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "../../docs/screenshots/scenario-model-mobile.png" });
  await page.getByRole("link", { name: "Open Studio manually" }).click();
  await expect(page.getByRole("button", { name: "Load cantilever example" })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("a project can be renamed from inside its workspace", async ({ page }) => {
  await page.goto("/scenario/new");
  await page.getByRole("button", { name: "Rename Untitled" }).click();
  await page.getByLabel("Project name").fill("  Workspace rename check  ");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Workspace rename check")).toBeVisible();
  await expect(page.getByRole("button", { name: "Rename Workspace rename check" })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Workspace rename check")).toBeVisible();
  await page.getByRole("button", { name: "Rename Workspace rename check" }).click();
  await page.getByLabel("Project name").fill("   ");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("The name must not be empty.")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("Workspace rename check")).toBeVisible();
  await page.goto("/projects");
  await expect(page.getByText("Workspace rename check")).toBeVisible();
});

test("the inspector shows one step at a time and paginates through them", async ({ page }) => {
  await page.goto("/scenario/new");
  await page.getByRole("button", { name: "Load Classroom Demo" }).click();
  await expect(page.getByRole("heading", { name: "Load path" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Inputs" })).toHaveCount(0);
  await expect(page.locator('nav[aria-label="Inspector steps"]').getByRole("button", { name: /Checklist/ })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Inspector" })).toHaveCount(0);
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await expect(page.getByText("How the load travels to the supports, before any result is trusted.")).toBeVisible();
  await showInspectorStep(page, "Inputs");
  await expect(page.getByRole("heading", { name: "Inputs" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Load path" })).toHaveCount(0);
  await expect(page.getByText("The numbers and choices Drafty is using, one group at a time.")).toBeVisible();
  await expect(page.getByText("How the load travels to the supports, before any result is trusted.")).toHaveCount(0);
  await page.locator('nav[aria-label="Inspector pagination"]').getByRole("button", { name: /Next/ }).click();
  await expect(page.getByRole("heading", { name: "Evidence" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Inputs" })).toHaveCount(0);
  await page.locator('nav[aria-label="Inspector pagination"]').getByRole("button", { name: /Inputs/ }).click();
  await expect(page.getByRole("heading", { name: "Inputs" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Evidence" })).toHaveCount(0);
  await showInspectorStep(page, "Results");
  await expect(page.getByRole("button", { name: "Run Demo Analysis" })).toBeVisible();
  await expect(page.getByText("Last step")).toBeVisible();
});

test("a failed send leaves the scenario and the typed span in place", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/api/v1/scenarios/*/turn", (route) => route.abort());
  await page.goto("/scenario/new");
  await expect(page.getByRole("heading", { name: "Scenario assistant" })).toBeVisible();
  await showInspectorStep(page, "Inputs");
  await page.getByLabel("Span m").fill("6");
  await page.getByLabel("Describe the problem").fill("Review the span I typed.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(/failed|network|abort|unavailable/i).first()).toBeVisible();
  await expect(page.getByLabel("Span m")).toHaveValue("6");
  await expect(page.getByRole("heading", { name: "Scenario assistant" })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("an aluminum bracket opens in Studio and does not start CalculiX", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/scenario/new");
  await expect(page.getByText("AI not connected")).toBeVisible();
  await page.getByLabel("Describe the problem").fill(
    "Design an aluminum bracket. Force 200 N. Legs 80 mm by 80 mm. Thickness 8 mm. Bracket width 40 mm. Displacement limit 1 mm.",
  );
  await page.getByRole("button", { name: "Send" }).click();
  await showInspectorStep(page, "Results");
  await expect(page.getByText("Choose the fixed face")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve and open Studio" })).toHaveCount(0);
  await page.getByLabel("Fixed face").selectOption("xmin");
  await page.getByLabel("Load face").selectOption("zmax");
  await page.getByRole("button", { name: "Confirm faces" }).click();
  await expect(page.getByRole("button", { name: "Approve and open Studio" })).toBeVisible();
  await expect(page.getByText("CalculiX solid FEM, not started")).toBeVisible();
  await expect(page.getByText("3D simulation is not available")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Approve and open Studio" })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Approve and open Studio" }).click();
  await expect(page.getByLabel("Part")).toHaveValue("l_bracket");
  await expect(page.getByLabel("Material")).toHaveValue("aluminum_6061_t6");
  await page.locator('nav[aria-label="Design steps"]').getByRole("button", { name: /Loads/ }).click();
  await expect(page.getByLabel("Support")).toHaveValue("xmin");
  await expect(page.getByLabel("Load face")).toHaveValue("zmax");
  // Spec is already applied after Approve and open Studio — Studio exposes the
  // return button, not the pre-apply "Back to scenario" link.
  await expect(page.getByRole("link", { name: "Back to scenario" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Return to scenario" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Return to scenario" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Run analysis" })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("a bracket demo asks for the physical faces before Studio", async ({ page }) => {
  await page.goto("/scenario/new");
  await page.getByRole("button", { name: "Load Bracket Demo" }).click();
  await showInspectorStep(page, "Results");
  await expect(page.getByLabel("Fixed face")).toHaveValue("xmin");
  await expect(page.getByLabel("Load face")).toHaveValue("zmax");
  await expect(page.getByRole("button", { name: "Approve and open Studio" })).toHaveCount(0);
  await page.getByRole("button", { name: "Confirm faces" }).click();
  await expect(page.getByRole("button", { name: "Approve and open Studio" })).toBeVisible();
  await expect(page.getByText("CalculiX solid FEM, not started")).toBeVisible();
});

test("Load Bracket Demo → Confirm faces → Approve → Open Studio", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/scenario/new");
  await page.getByRole("button", { name: "Load Bracket Demo" }).click();
  await expect(page.getByText(/bracket-v1|Aluminum L-bracket demo/i).first()).toBeVisible({ timeout: 30_000 });
  await showInspectorStep(page, "Results");
  await expect(page.getByRole("button", { name: "Confirm faces" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve and open Studio" })).toHaveCount(0);
  await page.getByRole("button", { name: "Confirm faces" }).click();
  await expect(page.getByRole("button", { name: "Approve and open Studio" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Approve and open Studio" }).click();
  await expect(page.getByLabel("Part")).toHaveValue("l_bracket", { timeout: 30_000 });
  await expect(page.getByLabel("Material")).toHaveValue("aluminum_6061_t6");
  await expect(page.getByRole("button", { name: "Run analysis" })).toBeVisible();
  // Spec is already applied after Approve and open Studio — Studio exposes the
  // return button, not the pre-apply "Back to scenario" link.
  await expect(page.getByRole("link", { name: "Back to scenario" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Return to scenario" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Return to scenario" })).toBeEnabled();
  expect(pageErrors).toEqual([]);
});

test("a recording stays in the composer until the user sends it", async ({ page }) => {
  await page.addInitScript(() => {
    const rate = 24000;
    const samples = 480;
    const buffer = new ArrayBuffer(44 + samples * 2);
    const view = new DataView(buffer);
    const ascii = (offset: number, text: string) => {
      for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
    };
    ascii(0, "RIFF");
    view.setUint32(4, 36 + samples * 2, true);
    ascii(8, "WAVE");
    ascii(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    ascii(36, "data");
    view.setUint32(40, samples * 2, true);
    class FakeRecorder {
      state = "inactive";
      mimeType = "audio/wav";
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob([buffer], { type: "audio/wav" }) });
        this.onstop?.();
      }
    }
    Object.defineProperty(window, "MediaRecorder", { configurable: true, value: FakeRecorder });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) },
    });
    class FakeUtterance {
      lang = "";
      rate = 1;
      voice: { lang: string } | null = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(public text: string) {}
    }
    Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, value: FakeUtterance });
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        speaking: false,
        cancel() {},
        speak(utterance: { onend?: (() => void) | null }) {
          window.setTimeout(() => utterance.onend?.(), 5000);
        },
        getVoices() {
          return [
            { lang: "en-US", name: "English" },
            { lang: "es-ES", name: "Spanish" },
          ];
        },
      },
    });
  });
  await page.route("**/api/v1/speech/transcribe", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ transcript: "What is the beam span?" }) }),
  );
  await page.goto("/scenario/new");
  await page.getByRole("button", { name: "Microphone" }).click();
  await page.getByRole("button", { name: "Cancel recording" }).click();
  await expect(page.getByText("Recording cancelled")).toBeVisible();
  await expect(page.getByLabel("Describe the problem")).toHaveValue("");
  await page.getByRole("button", { name: "Microphone" }).click();
  await page.getByRole("button", { name: /Stop/ }).click();
  await expect(page.getByLabel("Describe the problem")).toHaveValue("What is the beam span?");
  await page.getByRole("button", { name: "Load Classroom Demo" }).click();
  await page.getByLabel("Speech language").first().selectOption("es");
  await page.getByRole("button", { name: "Play speech" }).first().click();
  await expect(page.getByText("Spoken text:").first()).toBeVisible();
  await page.getByRole("button", { name: "Stop speech" }).first().click();
  await expect(page.getByRole("button", { name: "Play speech" }).first()).toBeVisible();
});

test("speech playback explains when the browser has no speech engine", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: undefined });
  });
  await page.goto("/scenario/new");
  await page.getByRole("button", { name: "Load Classroom Demo" }).click();
  await expect(page.getByText("Speech playback is not available on this device.").first()).toBeVisible();
});

test("an unsupported part lists what Drafty can model instead of the beam form", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/scenario/new");
  await expect(page.getByText("AI not connected")).toBeVisible();
  await page.getByLabel("Describe the problem").fill("Make me a 3D model of a coffee mug for printing.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Drafty can't model a coffee mug yet.").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Supported parts" })).toBeVisible();
  await expect(page.getByText("Part not supported yet")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Inputs" })).toHaveCount(0);
  await expect(page.getByLabel("Span m")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Load path" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "See everything Drafty can and cannot do" })).toBeVisible();
  if (process.env.DRAFTY_SCREENSHOT_DIR) {
    await page.screenshot({ path: `${process.env.DRAFTY_SCREENSHOT_DIR}/unsupported-part.png` });
  }
  const opened = page.waitForEvent("popup");
  await page.locator("article").last().getByRole("link", { name: "/capabilities" }).click();
  const capabilities = await opened;
  await expect(capabilities.getByRole("heading", { name: "What Drafty can and cannot do" })).toBeVisible();
  await expect(capabilities.getByRole("heading", { name: "Drafty cannot" })).toBeVisible();
  await expect(capabilities.getByRole("heading", { name: "Staunton chess pawn" })).toBeVisible();
  await expect(page.getByText("Part not supported yet")).toBeVisible();
});

test("a chess pawn builds a revolved profile with a preview and downloads, and no solve", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/scenario/new");
  await expect(page.getByText("AI not connected")).toBeVisible();
  await page.getByLabel("Describe the problem").fill("I want to design a basic chess pawn to render in 3D.");
  await page.getByRole("button", { name: "Send" }).click();
  await showInspectorStep(page, "Inputs");
  await expect(page.getByLabel("Height mm")).toBeVisible();
  await expect(page.getByLabel("Span m")).toHaveCount(0);
  await page.getByLabel("Describe the problem").fill("Staunton pawn, 50 mm tall, 28 mm base, STEP, decorative PLA.");
  await page.getByRole("button", { name: "Send" }).click();
  await showInspectorStep(page, "Model");
  await expect(page.getByRole("heading", { name: "Geometry" })).toBeVisible();
  await expect(page.getByText("no structural check was run").first()).toBeVisible();
  await showInspectorStep(page, "Inputs");
  await expect(page.getByLabel("Height mm")).toHaveValue("50");
  await showInspectorStep(page, "Model");
  await expect(page.getByText("Building the preview.")).toHaveCount(0, { timeout: 60_000 });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download STL" }).click();
  expect((await download).suggestedFilename()).toBe("staunton-pawn.stl");
  if (process.env.DRAFTY_SCREENSHOT_DIR) {
    await page.screenshot({ path: `${process.env.DRAFTY_SCREENSHOT_DIR}/pawn-geometry.png`, fullPage: true });
  }
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

function mechanicalStudioSession(id: string, name: string, thicknessM = 0.008) {
  return {
    id,
    name,
    missing: [],
    messages: [],
    evidence: [],
    errors: [],
    assumptions: [],
    sources: [],
    verification: [],
    model_questions: [],
    observations: [],
    mode: "guided",
    model: null,
    calculation: null,
    section: null,
    beam: null,
    analysis: null,
    comparison: null,
    ai: "off",
    jobs: [],
    inputs: {},
    model_proposal: {
      family: "l_bracket",
      ready_for_3d_simulation: true,
      reason: "mocked",
    },
    engineering: {
      domain: "mechanical",
      physical_system: "bracket",
      missing: [],
      suitable_methods: ["solid_fem"],
      unsupported: [],
      validation_status: "proposed",
      simulator: "calculix",
      quantities: [],
    },
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
      bracket: { leg_x_m: 0.08, leg_z_m: 0.08, thickness_m: thicknessM, width_m: 0.04 },
      holes: null,
      additions: [],
    },
    geometry_spec: null,
  };
}

const tinyGlb = Buffer.from(
  "Z2xURgIAAACEAAAASAAAAAAAAABAAAAAAAAAAFgAAABiaW5hcnkAAAAAAAgAAAAAAAAAAAAAAAAAAAA=",
  "base64",
);

test("scenario Model does not auto-call designs/preview for a studio_spec", async ({ page }) => {
  const scenarioId = "abc2180d-e0e3-4ddb-87cc-da3f8ada8c7b";
  let previewPosts = 0;
  const session = mechanicalStudioSession(scenarioId, "Retained Batch 10A");
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
  await page.route("**/api/v1/models", (route) => route.fulfill({ json: { models: [] } }));
  await page.route(`**/api/v1/scenarios/${scenarioId}`, (route) => route.fulfill({ json: session }));
  await page.route("**/api/v1/designs/preview", async (route) => {
    previewPosts += 1;
    await route.fulfill({ status: 500, json: { detail: "preview stubbed in this test" } });
  });

  await page.goto(`/scenario/${scenarioId}`);
  await showInspectorStep(page, "Model");
  await expect(page.getByRole("button", { name: "Generate preview" })).toBeVisible();
  await expect(page.getByText(/does not generate CAD/i)).toBeVisible();
  await expect.poll(() => previewPosts).toBe(0);

  await page.reload();
  await showInspectorStep(page, "Model");
  await expect(page.getByRole("button", { name: "Generate preview" })).toBeVisible();
  await expect.poll(() => previewPosts).toBe(0);

  await page.getByRole("button", { name: "Generate preview" }).click();
  await expect.poll(() => previewPosts).toBe(1);
});

test("explicit Generate preview succeeds and rebuild stays gated behind the button", async ({ page }) => {
  const scenarioId = "abc2180d-e0e3-4ddb-87cc-da3f8ada8c7b";
  let previewPosts = 0;
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
  await page.route("**/api/v1/models", (route) => route.fulfill({ json: { models: [] } }));
  await page.route(`**/api/v1/scenarios/${scenarioId}`, (route) =>
    route.fulfill({ json: mechanicalStudioSession(scenarioId, "Retained Batch 10A") }),
  );
  await page.route("**/api/v1/designs/preview", async (route) => {
    previewPosts += 1;
    await route.fulfill({
      status: 200,
      contentType: "model/gltf-binary",
      body: tinyGlb,
    });
  });

  await page.goto(`/scenario/${scenarioId}`);
  await showInspectorStep(page, "Model");
  await expect.poll(() => previewPosts).toBe(0);
  await page.getByRole("button", { name: "Generate preview" }).click();
  await expect(page.getByRole("button", { name: "Rebuild preview" })).toBeVisible();
  await expect.poll(() => previewPosts).toBe(1);
  await expect(page.getByText("Building the preview.")).toHaveCount(0);
});

test("navigating away while preview is pending abandons the busy state", async ({ page }) => {
  const firstId = "abc2180d-e0e3-4ddb-87cc-da3f8ada8c7b";
  const secondId = "11111111-2222-4333-8444-555555555555";
  let releaseFirst: (() => void) | null = null;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let previewPosts = 0;

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
  await page.route("**/api/v1/models", (route) => route.fulfill({ json: { models: [] } }));
  await page.route(`**/api/v1/scenarios/${firstId}`, (route) =>
    route.fulfill({ json: mechanicalStudioSession(firstId, "First") }),
  );
  await page.route(`**/api/v1/scenarios/${secondId}`, (route) =>
    route.fulfill({ json: mechanicalStudioSession(secondId, "Second", 0.01) }),
  );
  await page.route("**/api/v1/designs/preview", async (route) => {
    previewPosts += 1;
    const body = route.request().postDataJSON() as { bracket?: { thickness_m?: number } };
    if (body.bracket?.thickness_m === 0.008) {
      await firstGate;
      await route.fulfill({
        status: 200,
        contentType: "model/gltf-binary",
        body: tinyGlb,
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "model/gltf-binary",
      body: tinyGlb,
    });
  });

  await page.goto(`/scenario/${firstId}`);
  await showInspectorStep(page, "Model");
  await page.getByRole("button", { name: "Generate preview" }).click();
  await expect(page.getByRole("button", { name: "Building preview" })).toBeVisible();
  await expect.poll(() => previewPosts).toBe(1);

  await page.goto(`/scenario/${secondId}`);
  await showInspectorStep(page, "Model");
  await expect(page.getByRole("button", { name: "Generate preview" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Building preview" })).toHaveCount(0);

  releaseFirst?.();
  await expect.poll(() => previewPosts).toBe(1);
  await expect(page.getByRole("button", { name: "Generate preview" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Rebuild preview" })).toHaveCount(0);
});

test("switching scenario before a prior preview completes never shows the stale solid", async ({ page }) => {
  const firstId = "abc2180d-e0e3-4ddb-87cc-da3f8ada8c7b";
  const secondId = "22222222-3333-4444-8555-666666666666";
  let releaseFirst: (() => void) | null = null;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let firstSettled = false;
  let secondPosts = 0;

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
  await page.route("**/api/v1/models", (route) => route.fulfill({ json: { models: [] } }));
  await page.route(`**/api/v1/scenarios/${firstId}`, (route) =>
    route.fulfill({ json: mechanicalStudioSession(firstId, "First") }),
  );
  await page.route(`**/api/v1/scenarios/${secondId}`, (route) =>
    route.fulfill({ json: mechanicalStudioSession(secondId, "Second", 0.012) }),
  );
  await page.route("**/api/v1/designs/preview", async (route) => {
    const body = route.request().postDataJSON() as { bracket?: { thickness_m?: number } };
    if (body.bracket?.thickness_m === 0.008) {
      await firstGate;
      firstSettled = true;
      await route.fulfill({
        status: 200,
        contentType: "model/gltf-binary",
        body: tinyGlb,
      });
      return;
    }
    secondPosts += 1;
    await route.fulfill({
      status: 200,
      contentType: "model/gltf-binary",
      body: tinyGlb,
    });
  });

  await page.goto(`/scenario/${firstId}`);
  await showInspectorStep(page, "Model");
  await page.getByRole("button", { name: "Generate preview" }).click();
  await expect(page.getByRole("button", { name: "Building preview" })).toBeVisible();

  await page.goto(`/scenario/${secondId}`);
  await showInspectorStep(page, "Model");
  await expect(page.getByRole("button", { name: "Generate preview" })).toBeVisible();

  releaseFirst?.();
  await expect.poll(() => firstSettled).toBe(true);
  await expect(page.getByRole("button", { name: "Rebuild preview" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Generate preview" })).toBeVisible();
  expect(secondPosts).toBe(0);

  await page.getByRole("button", { name: "Generate preview" }).click();
  await expect(page.getByRole("button", { name: "Rebuild preview" })).toBeVisible();
  await expect.poll(() => secondPosts).toBe(1);
});
