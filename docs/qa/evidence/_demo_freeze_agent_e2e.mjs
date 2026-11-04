/**
 * Demo freeze — ONE authorized production agentic E2E.
 * Caps: Meta conversational ≤3, CAD preview ≤1, Modal FEM ≤1.
 * Voice STT = 0. Optimization = 0. Automatic retries = 0.
 * Stops on first paid failure. Retains scenario/job/artifacts.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../../..");
const require = createRequire(path.join(root, "apps/web/package.json"));
const { chromium, expect } = require("@playwright/test");

const web = process.env.DRAFTY_QA_PRODUCTION_WEB || "https://drafty-web-umber.vercel.app";
const api = process.env.DRAFTY_QA_PRODUCTION_API || "https://drafty-api.vercel.app";
const email = process.env.DRAFTY_QA_EMAIL;
const password = process.env.DRAFTY_QA_PASSWORD;
const runId = process.env.DRAFTY_QA_BUDGET_RUN_ID || `demo-freeze-${Date.now()}`;
const expectedSha = (process.env.DRAFTY_QA_REQUIRE_PROD_COMMIT || "").slice(0, 7);
const shotDir = path.join(root, "docs", "screenshots");
const evidenceDir = path.join(root, "docs", "qa", "evidence");

const CAPS = { meta: 3, cad: 1, fem: 1 };
const counts = { meta: 0, cad: 0, fem: 0, speech: 0, optimize: 0 };
const posts = [];

if (!email || !password) {
  console.error("Missing DRAFTY_QA_EMAIL / DRAFTY_QA_PASSWORD");
  process.exit(2);
}

fs.mkdirSync(shotDir, { recursive: true });
fs.mkdirSync(evidenceDir, { recursive: true });

function stamp() {
  return new Date().toISOString();
}

async function apiGet(token, route) {
  const res = await fetch(`${api.replace(/\/$/, "")}${route}`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function accessToken(page) {
  return page.evaluate(() => {
    const candidates = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key) continue;
      const raw = localStorage.getItem(key);
      if (!raw || !raw.includes("access_token")) continue;
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed.access_token === "string") candidates.push(parsed.access_token);
        if (typeof parsed.currentSession?.access_token === "string") candidates.push(parsed.currentSession.access_token);
        if (typeof parsed.session?.access_token === "string") candidates.push(parsed.session.access_token);
      } catch {
        /* skip */
      }
    }
    return candidates.find((t) => t.startsWith("eyJ") && t.split(".").length === 3) || candidates[0] || null;
  });
}

async function showInspectorStep(page, label) {
  await page.locator('nav[aria-label="Inspector steps"]').getByRole("button", { name: new RegExp(label) }).click();
}

async function showRunStep(page, label) {
  await page.locator('nav[aria-label="Run steps"]').getByRole("button", { name: new RegExp(label) }).click();
}

async function waitMetaReady(page) {
  // Do not race the initial "AI not connected" flash before /health resolves.
  const health = await page
    .waitForResponse((res) => res.url().includes("/api/v1/health") && res.ok(), { timeout: 45_000 })
    .catch(() => null);
  if (health) {
    const body = await health.json().catch(() => null);
    if (body && body.meta === false) return false;
  }
  const ready = page.getByText(/Muse Spark.*ready|Responses API/i).first();
  try {
    await ready.waitFor({ state: "visible", timeout: 45_000 });
    return true;
  } catch {
    return ready.isVisible().catch(() => false);
  }
}

async function sendTurn(page, text) {
  if (counts.meta >= CAPS.meta) {
    throw new Error(`Meta budget exhausted (${CAPS.meta}); refusing further Send.`);
  }
  const turnPromise = page.waitForResponse(
    (res) =>
      res.url().includes("/api/v1/scenarios/") &&
      res.url().includes("/turn") &&
      res.request().method() === "POST",
    { timeout: 120_000 },
  );
  await page.getByLabel("Describe the problem").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
  counts.meta += 1;
  const res = await turnPromise;
  const body = await res.json().catch(() => null);
  posts.push({ kind: "meta_turn", status: res.status(), at: stamp(), meta_count: counts.meta });
  if (!res.ok()) {
    throw new Error(`Meta turn HTTP ${res.status()} — stopping (no retry). body=${JSON.stringify(body)?.slice(0, 400)}`);
  }
  // Wait for UI busy to clear
  await page.getByRole("button", { name: "Send" }).waitFor({ state: "visible", timeout: 120_000 });
  await page.waitForTimeout(800);
  return body;
}

function assistantTexts(session) {
  return (session?.messages || [])
    .filter((m) => m && m.role === "assistant")
    .map((m) => String(m.text || ""));
}

function looksLikeBracketProposal(session) {
  const blob = JSON.stringify(session || {}).toLowerCase();
  const hasBracket =
    blob.includes("l_bracket") ||
    blob.includes("bracket") ||
    (session?.inputs && String(session.inputs.part || session.inputs.family || "").toLowerCase().includes("bracket"));
  const thickness = Number(session?.inputs?.thickness_m ?? session?.bracket?.thickness_m ?? NaN);
  const force = Number(session?.inputs?.force_n ?? session?.loads?.force_n ?? NaN);
  return Boolean(hasBracket) || (Number.isFinite(thickness) && thickness > 0) || Number.isFinite(force);
}

function needsClarification(text) {
  const t = text.toLowerCase();
  return (
    /\?/.test(t) &&
    /(what|which|confirm|provide|missing|need|tell me|span|load|material|thickness|dimension)/i.test(t)
  );
}

const report = {
  runId,
  web,
  api,
  expectedSha,
  started_at: stamp(),
  caps: CAPS,
  counts,
  posts,
  checks: {},
  meta: {},
  cad: {},
  fem: {},
  persistence: {},
  fallback: {
    job_batch10a: "6066bc77-07d0-44ad-a49b-720b947d99fd",
    job_legacy: "4f8ed6cc-7d26-4a53-ba2a-ba1569ab4933",
  },
  errors: [],
  verdict: "PENDING",
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ baseURL: web, viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

page.on("request", (req) => {
  const url = req.url();
  const method = req.method();
  if (method !== "POST") return;
  if (url.includes("/api/v1/speech/")) counts.speech += 1;
  if (url.includes("/optimize")) counts.optimize += 1;
});

try {
  // --- Auth + health ---
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/projects/, { timeout: 60_000 });
  report.checks.auth = "PASS";

  const healthRes = await fetch(`${api}/api/v1/health`);
  const health = await healthRes.json();
  report.checks.health = {
    status: healthRes.status,
    auth: health.auth,
    meta: health.meta,
    modal: health.modal,
    modal_available: health.modal_available,
    compute: health.compute,
  };
  if (health.auth !== "supabase" || !health.meta || !health.modal_available) {
    throw new Error(`Production health gate failed: ${JSON.stringify(report.checks.health)}`);
  }
  report.checks.health_gate = "PASS";

  const continueId = (process.env.DRAFTY_QA_CONTINUE_SCENARIO || "").trim();
  const priorMeta = Number(process.env.DRAFTY_QA_PRIOR_META || "0") || 0;
  counts.meta = priorMeta;
  report.prior_meta_consumed = priorMeta;

  let scenarioId = continueId || null;
  let session = null;
  const tokenAfterAuth = await accessToken(page);
  if (!tokenAfterAuth) throw new Error("No access token after sign-in.");

  if (continueId) {
    await page.goto(`/scenario/${continueId}`);
    await expect(page).toHaveURL(new RegExp(`/scenario/${continueId}`), { timeout: 60_000 });
    const metaReady = await waitMetaReady(page);
    if (!metaReady) throw new Error("Meta UI not ready on continued scenario — stopping.");
    report.checks.meta_ui_ready = "PASS";
    report.checks.start_with_ai = "CONTINUED";
    report.scenarioId = continueId;
    const got = await apiGet(tokenAfterAuth, `/api/v1/scenarios/${continueId}`);
    if (got.status !== 200) throw new Error(`Continue scenario GET ${got.status}`);
    session = got.json;
    report.scenarioName = session?.name || continueId;
    report.meta.continued_from = {
      meta_turns: session?.meta_turns,
      usage: session?.session_usage || session?.usage,
      mode: session?.mode,
    };
  } else {
    // --- Start with AI ---
    await page.goto("/");
    await page.getByRole("link", { name: "Start with AI" }).first().click();
    await expect(page).toHaveURL(/\/scenario\//, { timeout: 60_000 });
    const metaReady = await waitMetaReady(page);
    if (!metaReady) throw new Error("Meta UI not ready (AI not connected) — stopping before paid Meta.");
    report.checks.meta_ui_ready = "PASS";

    await page.waitForTimeout(1500);
    scenarioId =
      (await page.evaluate(() => {
        const m = location.pathname.match(/\/scenario\/([0-9a-f-]{36})/i);
        return m?.[1] || null;
      })) || null;
    if (!scenarioId) {
      await page.waitForURL(/\/scenario\/[0-9a-f-]{36}/i, { timeout: 60_000 }).catch(() => null);
      scenarioId = (await page.url().match(/\/scenario\/([0-9a-f-]{36})/i))?.[1] || null;
    }
    if (!scenarioId) throw new Error("Could not resolve scenario id after Start with AI.");
    report.scenarioId = scenarioId;
    report.checks.start_with_ai = "PASS";

    const scenarioName = `DRAFTY_QA_demo_freeze_${runId}`.slice(0, 72);
    const renameBtn = page.getByRole("button", { name: /Rename/i }).first();
    if (await renameBtn.count()) {
      await renameBtn.click();
      const nameBox = page.getByRole("textbox").first();
      await nameBox.fill(scenarioName);
      await nameBox.press("Enter").catch(async () => {
        await nameBox.blur();
      });
      await page.waitForTimeout(800);
    }
    report.scenarioName = scenarioName;

    const prompt1 =
      "I need to design and analyze an aluminum L-bracket for a structural demo. " +
      "Legs 80 mm by 80 mm, bracket width 40 mm, thickness 8 mm. Material aluminum 6061-T6. " +
      "Apply a 200 N force with a 1 mm displacement limit. Use a quadratic C3D10 solid mesh. " +
      "Please propose the structured Drafty L-bracket engineering scenario with these exact values. " +
      "Ask only if a critical engineering field is missing; do not invent contradictory dimensions.";

    session = await sendTurn(page, prompt1);
    report.meta.turn1 = {
      http_ok: true,
      mode: session?.mode,
      model: session?.model_id || session?.model || session?.selected_model,
      meta_turns: session?.meta_turns,
      usage: session?.session_usage || session?.usage,
      previous_response_id: session?.previous_response_id,
    };
    for (let i = 0; i < 30; i += 1) {
      const got = await apiGet(tokenAfterAuth, `/api/v1/scenarios/${scenarioId}`);
      if (got.status === 200 && got.json) {
        session = got.json;
        if (assistantTexts(session).length >= 1) break;
      }
      await page.waitForTimeout(1000);
    }
    await page.screenshot({ path: path.join(shotDir, "demo-freeze-meta-turn1.png"), fullPage: true });
  }

  const token = tokenAfterAuth;
  if (!scenarioId) throw new Error("scenarioId missing");
  if (!session) {
    const got = await apiGet(token, `/api/v1/scenarios/${scenarioId}`);
    session = got.json;
  }
  if (String(session?.mode || "").toLowerCase().includes("offline")) {
    throw new Error("Offline template fallback — not a real Meta PASS. Stopping.");
  }

  async function refreshSession() {
    const got = await apiGet(token, `/api/v1/scenarios/${scenarioId}`);
    if (got.status === 200 && got.json) session = got.json;
    return session;
  }

  function missingForceOrLimit(s) {
    const force = Number(s?.inputs?.force_n ?? s?.inputs?.load_magnitude ?? NaN);
    const limit = Number(s?.inputs?.displacement_limit_m ?? NaN);
    return !(Number.isFinite(force) && force > 0) || !(Number.isFinite(limit) && limit > 0);
  }

  async function confirmFacesVisible() {
    await showInspectorStep(page, "Results").catch(() => null);
    return page.getByRole("button", { name: "Confirm faces" }).isVisible().catch(() => false);
  }

  // --- Follow-up Meta turns until faces can be confirmed (budget-capped) ---
  let lastAssistant = assistantTexts(session).at(-1) || "";
  report.meta.after_open = {
    mode: session.mode,
    meta_turns: session.meta_turns,
    usage: session.session_usage || session.usage,
    missing_force_or_limit: missingForceOrLimit(session),
    excerpt: lastAssistant.slice(0, 400),
  };

  if ((missingForceOrLimit(session) || needsClarification(lastAssistant) || !(await confirmFacesVisible())) && counts.meta < CAPS.meta) {
    // Fill visible Inputs as the user would, then confirm in chat.
    await showInspectorStep(page, "Inputs").catch(() => null);
    const forceField = page.getByLabel(/^Force N$/i);
    const limitField = page.getByLabel(/Displacement limit/i);
    if (await forceField.count()) await forceField.fill("200");
    if (await limitField.count()) await limitField.fill("1");
    const prompt2 =
      "Confirming the missing fields: force = 200 N, displacement limit = 1 mm. " +
      "Fixed (support) face = xmin on the vertical mounting leg. Load face = zmax on the horizontal tip. " +
      "Please finalize the L-bracket scenario with these values so Confirm faces appears.";
    session = await sendTurn(page, prompt2);
    await page.waitForTimeout(2000);
    await refreshSession();
    lastAssistant = assistantTexts(session).at(-1) || lastAssistant;
    report.meta.turn2 = {
      mode: session.mode,
      meta_turns: session.meta_turns,
      usage: session.session_usage || session.usage,
      excerpt: lastAssistant.slice(0, 400),
      missing_force_or_limit: missingForceOrLimit(session),
    };
    await page.screenshot({ path: path.join(shotDir, "demo-freeze-meta-turn2.png"), fullPage: true });
  }

  if ((missingForceOrLimit(session) || !(await confirmFacesVisible())) && counts.meta < CAPS.meta) {
    const prompt3 =
      "Force 200 N and displacement limit 1 mm are confirmed. Support face xmin, load face zmax. " +
      "Finalize now so I can confirm faces and open Studio.";
    session = await sendTurn(page, prompt3);
    await page.waitForTimeout(2000);
    await refreshSession();
    lastAssistant = assistantTexts(session).at(-1) || lastAssistant;
    report.meta.turn3 = {
      mode: session.mode,
      meta_turns: session.meta_turns,
      usage: session.session_usage || session.usage,
      excerpt: lastAssistant.slice(0, 400),
    };
    await page.screenshot({ path: path.join(shotDir, "demo-freeze-meta-turn3.png"), fullPage: true });
  }

  report.meta.final = {
    requests: counts.meta,
    session_meta_turns: session?.meta_turns,
    usage: session?.session_usage || session?.usage,
    model: session?.model_id || session?.model || session?.selected_model,
    mode: session?.mode,
    previous_response_id: session?.previous_response_id,
    inputs: session?.inputs || null,
    bracket: session?.bracket || null,
  };
  report.checks.meta_agent =
    (session?.meta_turns || counts.meta) > 0 && !String(session?.mode || "").includes("offline") ? "PASS" : "FAIL";
  if (report.checks.meta_agent !== "PASS") throw new Error("Meta agent path failed.");

  // --- Confirm faces (UI) / open Studio ---
  const alreadyInStudio = async () => {
    if (!/\/studio/i.test(page.url())) return false;
    return page.getByLabel("Part").inputValue().then((v) => v === "l_bracket").catch(() => false);
  };

  if (process.env.DRAFTY_QA_SKIP_TO_STUDIO === "1") {
    await page.goto("/studio");
    await expect(page.getByLabel("Part")).toHaveValue("l_bracket", { timeout: 90_000 });
    report.checks.confirm_faces = "SKIPPED_CONTINUE";
    report.checks.open_studio = "PASS";
  } else if (!(await alreadyInStudio())) {
    await showInspectorStep(page, "Results");
    const fixed = page.getByLabel("Fixed face");
    const loadFace = page.getByLabel("Load face");
    if (await fixed.count()) await fixed.selectOption("xmin");
    if (await loadFace.count()) await loadFace.selectOption("zmax");
    const confirmBtn = page.getByRole("button", { name: "Confirm faces" });
    const approveBtn = page.getByRole("button", { name: "Approve and open Studio" });
    if (await confirmBtn.isVisible().catch(() => false)) {
      await confirmBtn.click();
      await expect(approveBtn).toBeVisible({ timeout: 60_000 });
      report.checks.confirm_faces = "PASS";
    } else if (await approveBtn.isVisible().catch(() => false)) {
      report.checks.confirm_faces = "ALREADY_CONFIRMED";
    } else {
      await expect(confirmBtn).toBeVisible({ timeout: 60_000 });
    }
    await page.screenshot({ path: path.join(shotDir, "demo-freeze-faces-confirmed.png"), fullPage: true });
    await page.getByRole("button", { name: "Approve and open Studio" }).click();
    await expect(page.getByLabel("Part")).toHaveValue("l_bracket", { timeout: 90_000 });
    report.checks.open_studio = "PASS";
  } else {
    report.checks.confirm_faces = "ALREADY_IN_STUDIO";
    report.checks.open_studio = "PASS";
  }
  await expect(page.getByLabel("Order")).toHaveValue("2");
  await page.screenshot({ path: path.join(shotDir, "demo-freeze-studio-open.png"), fullPage: true });

  // Ensure Loads faces in Studio match benchmark before CAD/FEM
  const loadsTab = page.locator('nav[aria-label="Design steps"]').getByRole("button", { name: /Loads/i });
  if (await loadsTab.count()) {
    await loadsTab.click().catch(() => null);
    const support = page.getByLabel(/Support|Fixed/i).first();
    const loadSurface = page.getByLabel(/^Load$/i).first();
    if (await support.count()) await support.selectOption("xmin").catch(() => null);
    if (await loadSurface.count()) await loadSurface.selectOption("zmax").catch(() => null);
  }

  // --- CAD preview exactly once ---
  if (counts.cad >= CAPS.cad) throw new Error("CAD budget already used");
  // Bottom toolbar uses "Preview rebuild solid"; Loads step uses "Preview solid".
  const previewBtn = page.getByRole("button", { name: /Preview( rebuild)? solid|^Preview$/i }).first();
  await expect(previewBtn).toBeVisible({ timeout: 30_000 });
  const previewPromise = page.waitForResponse(
    (res) => res.url().includes("/api/v1/designs/preview") && res.request().method() === "POST",
    { timeout: 180_000 },
  );
  await previewBtn.click();
  counts.cad += 1;
  const previewRes = await previewPromise;
  posts.push({ kind: "cad_preview", status: previewRes.status(), at: stamp() });
  if (!previewRes.ok()) {
    throw new Error(`CAD preview HTTP ${previewRes.status()} — stopping (no retry).`);
  }
  report.cad = { status: previewRes.status(), count: counts.cad };
  report.checks.cad_preview = "PASS";
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(shotDir, "demo-freeze-cad-preview.png"), fullPage: true });

  // --- FEM exactly once (Modal) ---
  const modalRadio = page.getByLabel(/Modal/i);
  if (await modalRadio.count()) {
    await modalRadio.check().catch(async () => {
      await page.getByText(/Modal Cloud/i).first().click();
    });
  }
  if (counts.fem >= CAPS.fem) throw new Error("FEM budget already used");
  const jobPromise = page.waitForResponse(
    (res) =>
      res.url().includes("/api/v1/jobs") &&
      !res.url().match(/\/jobs\/[^/]+/) &&
      res.request().method() === "POST",
    { timeout: 60_000 },
  );
  await page.getByRole("button", { name: "Run analysis" }).click();
  counts.fem += 1;
  const jobRes = await jobPromise;
  const submitted = await jobRes.json().catch(() => null);
  posts.push({ kind: "fem_job", status: jobRes.status(), at: stamp(), jobId: submitted?.id });
  if (!jobRes.ok() || !submitted?.id) {
    throw new Error(`FEM submit HTTP ${jobRes.status()} — stopping (no retry).`);
  }
  report.fem.jobId = submitted.id;
  report.fem.submit = { status: jobRes.status(), compute: submitted.compute, status_field: submitted.status };

  // Poll job to terminal (no re-submit)
  let terminal = null;
  const deadline = Date.now() + 360_000;
  while (Date.now() < deadline) {
    const got = await apiGet(token, `/api/v1/jobs/${submitted.id}`);
    terminal = got.json;
    const st = String(terminal?.status || "");
    if (["completed", "failed", "error", "cancelled", "canceled"].includes(st)) break;
    await page.waitForTimeout(3000);
  }
  report.fem.terminal = {
    status: terminal?.status,
    compute: terminal?.compute,
    message: terminal?.message,
    error: terminal?.error,
  };
  if (String(terminal?.status) !== "completed") {
    throw new Error(`FEM job did not complete: ${JSON.stringify(report.fem.terminal)} — stopping (no retry).`);
  }

  const resultsResp = await apiGet(token, `/api/v1/jobs/${submitted.id}/results`);
  if (resultsResp.status !== 200) throw new Error(`results.json HTTP ${resultsResp.status}`);
  const results = resultsResp.json;
  report.fem.results = {
    solver: results?.solver,
    mesh: results?.mesh,
    max_displacement_m: results?.max_displacement_m,
    max_von_mises_pa: results?.max_von_mises_pa,
    governing_von_mises_pa: results?.governing_von_mises_pa,
    equilibrium: results?.equilibrium,
    validation_status: results?.validation_status,
    quality: {
      element_type: results?.mesh?.element_type || results?.quality?.element_type,
      elements: results?.mesh?.elements,
      jacobian_validation_status: results?.jacobian_validation_status || results?.quality?.jacobian_validation_status,
      normalized_jacobian_ratio_min: results?.normalized_jacobian_ratio_min,
      inverted_elements: results?.inverted_elements,
      quality_warnings: results?.quality_warnings,
      mesh_validity: results?.mesh_validity || results?.quality_gates?.mesh_validity,
    },
  };
  report.checks.fem = "PASS";

  // UI results + mesh quality
  await showRunStep(page, "Results").catch(() => null);
  await expect(page.getByText(/Governing von Mises|von Mises/i).first()).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: path.join(shotDir, "demo-freeze-fem-results.png"), fullPage: true });

  // Download report artifact
  const reportJson = await apiGet(token, `/api/v1/jobs/${submitted.id}/artifacts/report.json`);
  report.fem.report_json_status = reportJson.status;
  if (reportJson.status >= 400) {
    throw new Error(`report.json HTTP ${reportJson.status} — stopping.`);
  }
  report.checks.report_download = "PASS";

  // PDF link if present
  const pdfLink = page.getByRole("link", { name: /report\.pdf/i });
  if (await pdfLink.count()) {
    report.fem.pdf_link = true;
  }

  // --- Reload persistence ---
  await page.reload();
  await page.getByRole("tab", { name: /Jobs queue/ }).click().catch(() => null);
  await expect(page.getByRole("cell", { name: submitted.id.slice(0, 8) })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("cell", { name: submitted.id.slice(0, 8) }).click();
  await showRunStep(page, "Results");
  await expect(page.getByText(/Governing von Mises|Mesh quality|Solver completion|von Mises/i).first()).toBeVisible({
    timeout: 60_000,
  });
  report.persistence = { reload: "PASS", jobId: submitted.id };
  report.checks.persistence = "PASS";
  await page.screenshot({ path: path.join(shotDir, "demo-freeze-reload.png"), fullPage: true });

  // Budget integrity
  if (counts.speech > 0) throw new Error("Speech/STT was invoked — forbidden for this run.");
  if (counts.optimize > 0) throw new Error("Optimization was invoked — forbidden.");
  if (counts.meta > CAPS.meta || counts.cad > CAPS.cad || counts.fem > CAPS.fem) {
    throw new Error(`Budget overrun: ${JSON.stringify(counts)}`);
  }

  report.checks.budget = {
    meta: `${counts.meta}/${CAPS.meta}`,
    cad: `${counts.cad}/${CAPS.cad}`,
    fem: `${counts.fem}/${CAPS.fem}`,
    speech: counts.speech,
    optimize: counts.optimize,
  };
  report.finished_at = stamp();
  report.verdict = "PASS";
  console.log(JSON.stringify({ demo_freeze: "PASS", ...report.checks, fem_job: report.fem.jobId, meta: report.meta.final }, null, 2));
} catch (error) {
  report.errors.push(String(error).slice(0, 1200));
  report.finished_at = stamp();
  report.verdict = "FAIL";
  report.counts = counts;
  try {
    await page.screenshot({ path: path.join(shotDir, "demo-freeze-FAILURE.png"), fullPage: true });
  } catch {
    /* ignore */
  }
  console.error("DEMO_FREEZE_FAIL", String(error));
} finally {
  const out = path.join(evidenceDir, `demo-freeze-agent_${runId}.json`);
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log("EVIDENCE", out);
  await browser.close();
  process.exit(report.verdict === "PASS" ? 0 : 1);
}
