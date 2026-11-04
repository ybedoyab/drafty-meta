import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  archiveMetaEvidencePath,
  clearEvidenceForTests,
  isScenarioRetained,
  mayCleanupScenario,
  recordMetaScenarioRetained,
  recordedMetaScenarios,
  releaseRetainedScenario,
  retainScenarioEvidence,
  updateMetaEvidence,
} from "./evidence";
import {
  detectInventedMetaQaLoads,
  evaluateMetaProviderSession,
  isAssistantRoleLabel,
  isMetaQaScenarioName,
  latestAssistantText,
} from "./meta-verify";
import {
  budgetAccounting,
  recordCompletedResponse,
  recordUiAssertion,
  resetPaidBudget,
  tryConsume,
} from "./budget";

const SCENARIO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const validMetaSession = {
  id: SCENARIO,
  name: "DRAFTY_QA_meta_fixture",
  mode: "meta-responses",
  meta_turns: 1,
  previous_response_id: "resp_test_fixture_001",
  usage: { input_tokens: 1995, output_tokens: 438, total_tokens: 2433 },
  messages: [
    {
      role: "user",
      text: "I need an I-beam for a classroom floor for 30 students in Colombia.",
    },
    {
      role: "assistant",
      text: "Still needed: span, tributary width, dead load, supports. A headcount is not a floor load.",
    },
  ],
  inputs: { span_m: null, dead_n_per_m2: null, live_n_per_m2: null },
};

describe("Meta QA evidence + provider verification", () => {
  const evidenceDir = path.join(os.tmpdir(), `drafty-qa-meta-evidence-vitest-${process.pid}`);
  const evidenceTmp = path.join(os.tmpdir(), `drafty-qa-fem-evidence-meta-vitest-${process.pid}.json`);
  const metaTmp = path.join(os.tmpdir(), `drafty-qa-meta-evidence-vitest-${process.pid}.json`);
  const retentionTmp = path.join(os.tmpdir(), `drafty-qa-retained-meta-vitest-${process.pid}.json`);
  beforeEach(() => {
    vi.stubEnv("DRAFTY_QA_BUDGET_RUN_ID", `vitest-meta-${process.pid}`);
    vi.stubEnv("DRAFTY_QA_RELEASE_RETAINED", "");
    vi.stubEnv("DRAFTY_QA_EVIDENCE_DIR", evidenceDir);
    vi.stubEnv("DRAFTY_QA_EVIDENCE_TMP", evidenceTmp);
    vi.stubEnv("DRAFTY_QA_META_EVIDENCE_TMP", metaTmp);
    vi.stubEnv("DRAFTY_QA_RETENTION_TMP", retentionTmp);
    // budget.ts reads OS tmp path at import; reset via resetPaidBudget after env is set.
    fs.mkdirSync(evidenceDir, { recursive: true });
    clearEvidenceForTests();
    resetPaidBudget();
  });

  afterEach(() => {
    clearEvidenceForTests();
    resetPaidBudget();
    vi.unstubAllEnvs();
  });

  it("accepts a valid Meta provider response and rejects offline-template as PASS", () => {
    const ok = evaluateMetaProviderSession(validMetaSession);
    expect(ok.ok).toBe(true);
    expect(ok.offlineFallback).toBe(false);
    expect(ok.previous_response_id).toBe("resp_test_fixture_001");
    expect(latestAssistantText(validMetaSession)).toContain("Still needed");

    const offline = evaluateMetaProviderSession({
      ...validMetaSession,
      mode: "offline-template",
      previous_response_id: null,
    });
    expect(offline.ok).toBe(false);
    expect(offline.offlineFallback).toBe(true);
  });

  it("rejects invented canonical span/loads and fabricated citations on Meta QA scenarios", () => {
    expect(isMetaQaScenarioName("DRAFTY_QA_meta_fixture")).toBe(true);
    expect(detectInventedMetaQaLoads({ dead_n_per_m2: 3000, live_n_per_m2: null, span_m: null })).toContain(
      "dead_n_per_m2",
    );
    expect(detectInventedMetaQaLoads({ live_n_per_m2: 2000, dead_n_per_m2: null, span_m: null })).toContain(
      "live_n_per_m2",
    );
    expect(detectInventedMetaQaLoads({ span_m: 6, dead_n_per_m2: null, live_n_per_m2: null })).toContain(
      "span_m",
    );
    expect(detectInventedMetaQaLoads({ span_m: null, dead_n_per_m2: null, live_n_per_m2: null })).toBeNull();

    expect(
      evaluateMetaProviderSession({
        ...validMetaSession,
        inputs: { span_m: 6.0, dead_n_per_m2: null, live_n_per_m2: null },
      }).ok,
    ).toBe(false);
    expect(
      evaluateMetaProviderSession({
        ...validMetaSession,
        inputs: { span_m: null, dead_n_per_m2: 2500, live_n_per_m2: null },
      }).reason,
    ).toContain("dead_n_per_m2");
    expect(
      evaluateMetaProviderSession({
        ...validMetaSession,
        inputs: { span_m: null, dead_n_per_m2: null, live_n_per_m2: 1800 },
      }).reason,
    ).toContain("live_n_per_m2");
    // Legacy alias still detected when present on a Meta QA session.
    expect(
      evaluateMetaProviderSession({
        ...validMetaSession,
        inputs: { dead_load_kpa: 3 },
      }).ok,
    ).toBe(false);
    expect(
      evaluateMetaProviderSession({
        ...validMetaSession,
        messages: [
          ...validMetaSession.messages,
          { role: "assistant", text: "According to ASCE 7-22 Section 4.3 the live load is 2 kPa." },
        ],
      }).ok,
    ).toBe(false);
  });

  it("does not treat user-provided loads as invented outside Meta QA scenario names", () => {
    const general = evaluateMetaProviderSession({
      ...validMetaSession,
      name: "classroom-design",
      inputs: { span_m: 6, dead_n_per_m2: 3000, live_n_per_m2: 2000 },
    });
    expect(general.ok).toBe(true);
    expect(isMetaQaScenarioName("classroom-design")).toBe(false);
  });

  it("matches the real assistant role label Drafty without requiring a colon", () => {
    expect(isAssistantRoleLabel("Drafty")).toBe(true);
    expect(isAssistantRoleLabel("Drafty:")).toBe(false);
    expect(isAssistantRoleLabel("You")).toBe(false);
  });

  it("retains Meta scenarios before invoke and skips afterAll / leftover cleanup", () => {
    recordMetaScenarioRetained({
      scenarioId: SCENARIO,
      scenarioName: "DRAFTY_QA_meta_fixture",
      owner: "primary",
    });
    expect(isScenarioRetained(SCENARIO)).toBe(true);
    expect(mayCleanupScenario(SCENARIO)).toBe(false);
    expect(recordedMetaScenarios()[0]?.phase).toBe("created");
    expect(fs.existsSync(archiveMetaEvidencePath())).toBe(true);

    updateMetaEvidence(SCENARIO, { phase: "invoked", retain: true });
    expect(mayCleanupScenario(SCENARIO)).toBe(false);
    expect(mayCleanupScenario(OTHER)).toBe(true);
  });

  it("keeps Meta retention across a different budget run id", () => {
    const runA = `vitest-meta-a-${process.pid}`;
    const runB = `vitest-meta-b-${process.pid}`;
    vi.stubEnv("DRAFTY_QA_BUDGET_RUN_ID", runA);
    recordMetaScenarioRetained({ scenarioId: SCENARIO, scenarioName: "meta-a", owner: "primary" });
    const archiveA = archiveMetaEvidencePath();
    expect(fs.existsSync(archiveA)).toBe(true);

    vi.stubEnv("DRAFTY_QA_BUDGET_RUN_ID", runB);
    expect(isScenarioRetained(SCENARIO)).toBe(true);
    expect(mayCleanupScenario(SCENARIO)).toBe(false);
    expect(recordedMetaScenarios().some((item) => item.scenarioId === SCENARIO)).toBe(true);
    expect(fs.existsSync(archiveA)).toBe(true);
  });

  it("counts provider completion even when a later UI assertion fails", () => {
    expect(tryConsume("meta")).toBe(true);
    recordMetaScenarioRetained({ scenarioId: SCENARIO, owner: "primary" });
    const verdict = evaluateMetaProviderSession(validMetaSession);
    expect(verdict.ok).toBe(true);
    recordCompletedResponse("meta");
    updateMetaEvidence(SCENARIO, {
      phase: "provider_ok",
      mode: verdict.mode,
      meta_turns: verdict.meta_turns,
      previous_response_id: verdict.previous_response_id,
      usage: verdict.usage,
      retain: true,
    });

    // Simulate UI selector failure after provider success.
    let uiFailed = false;
    try {
      throw new Error("expect(locator).toBeVisible() failed: getByText('Drafty:')");
    } catch {
      uiFailed = true;
      updateMetaEvidence(SCENARIO, { phase: "ui_assert_failed", retain: true });
    }
    expect(uiFailed).toBe(true);
    // UI assert never recorded — provider completed_responses must stay 1.
    expect(budgetAccounting().completed_responses.meta).toBe(1);
    expect(budgetAccounting().ui_assertions.meta).toBe(0);
    expect(isScenarioRetained(SCENARIO)).toBe(true);
    expect(recordedMetaScenarios()[0]?.phase).toBe("ui_assert_failed");
  });

  it("does not count offline fallback as provider success", () => {
    expect(tryConsume("meta")).toBe(true);
    const offline = evaluateMetaProviderSession({
      mode: "offline-template",
      meta_turns: 1,
      messages: [{ role: "assistant", text: "Template reply" }],
      inputs: {},
    });
    expect(offline.ok).toBe(false);
    expect(offline.offlineFallback).toBe(true);
    if (offline.ok) recordCompletedResponse("meta");
    expect(budgetAccounting().completed_responses.meta).toBe(0);
  });

  it("survives mocked scenario persistence + reload evaluation", () => {
    recordMetaScenarioRetained({ scenarioId: SCENARIO, scenarioName: "reload", owner: "primary" });
    const persisted = structuredClone(validMetaSession);
    // Simulate reload: re-fetch scenario JSON and re-evaluate.
    const afterReload = evaluateMetaProviderSession(persisted);
    expect(afterReload.ok).toBe(true);
    updateMetaEvidence(SCENARIO, {
      phase: "provider_ok",
      mode: afterReload.mode,
      meta_turns: afterReload.meta_turns,
      previous_response_id: afterReload.previous_response_id,
      usage: afterReload.usage,
      assistantExcerpt: afterReload.assistantText,
      retain: true,
    });
    recordCompletedResponse("meta");
    recordUiAssertion("meta");
    expect(budgetAccounting().completed_responses.meta).toBe(1);
    expect(budgetAccounting().ui_assertions.meta).toBe(1);
    expect(mayCleanupScenario(SCENARIO)).toBe(false);
    releaseRetainedScenario(SCENARIO);
    expect(mayCleanupScenario(SCENARIO)).toBe(true);
  });

  it("does not weaken FEM retainScenarioEvidence when Meta helpers run", () => {
    retainScenarioEvidence(OTHER);
    recordMetaScenarioRetained({ scenarioId: SCENARIO, owner: "primary" });
    expect(isScenarioRetained(OTHER)).toBe(true);
    expect(isScenarioRetained(SCENARIO)).toBe(true);
    expect(mayCleanupScenario(OTHER)).toBe(false);
    expect(mayCleanupScenario(SCENARIO)).toBe(false);
  });
});
