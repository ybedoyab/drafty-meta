import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearEvidenceForTests,
  inspectJobsInventory,
  mayCleanupScenario,
  planQaOwnedLeftoverCleanup,
  releaseRetainedScenario,
  retainScenarioEvidence,
} from "./evidence";

const SCENARIO_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SCENARIO_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const UNRELATED = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const META_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const META_NAME = "DRAFTY_QA_meta_2026-11-04T17-48-13";
const CLEANUP_NAME = "DRAFTY_QA_cleanup_fixture";

describe("production leftover cleanup fail-closed jobs inventory", () => {
  const evidenceDir = path.join(os.tmpdir(), `drafty-qa-leftover-vitest-${process.pid}`);
  const evidenceTmp = path.join(os.tmpdir(), `drafty-qa-fem-leftover-vitest-${process.pid}.json`);
  const metaTmp = path.join(os.tmpdir(), `drafty-qa-meta-leftover-vitest-${process.pid}.json`);
  const retentionTmp = path.join(os.tmpdir(), `drafty-qa-retained-leftover-vitest-${process.pid}.json`);

  beforeEach(() => {
    vi.stubEnv("DRAFTY_QA_BUDGET_RUN_ID", `vitest-leftover-${process.pid}`);
    vi.stubEnv("DRAFTY_QA_RELEASE_RETAINED", "");
    vi.stubEnv("DRAFTY_QA_EVIDENCE_DIR", evidenceDir);
    vi.stubEnv("DRAFTY_QA_EVIDENCE_TMP", evidenceTmp);
    vi.stubEnv("DRAFTY_QA_META_EVIDENCE_TMP", metaTmp);
    vi.stubEnv("DRAFTY_QA_RETENTION_TMP", retentionTmp);
    fs.mkdirSync(evidenceDir, { recursive: true });
    clearEvidenceForTests();
  });

  afterEach(() => {
    clearEvidenceForTests();
    vi.unstubAllEnvs();
  });

  it("treats HTTP 503 jobs inventory as unavailable (not empty)", () => {
    const inventory = inspectJobsInventory(503, { jobs: [] });
    expect(inventory.available).toBe(false);
    if (inventory.available) return;
    expect(inventory.reason).toContain("503");

    const plan = planQaOwnedLeftoverCleanup({
      scenarioIds: [SCENARIO_A, UNRELATED],
      production: true,
      inventory,
    });
    expect(plan.abortDestructive).toBe(true);
    expect(plan.deleteIds).toEqual([]);
    expect(plan.skipped).toEqual([
      `${SCENARIO_A}:jobs-inventory-unavailable`,
      `${UNRELATED}:jobs-inventory-unavailable`,
    ]);
  });

  it("treats HTTP 401 jobs inventory as unauthorized and aborts production deletes", () => {
    const inventory = inspectJobsInventory(401, { detail: "unauthorized" });
    expect(inventory.available).toBe(false);
    if (inventory.available) return;
    expect(inventory.reason).toContain("401");

    const plan = planQaOwnedLeftoverCleanup({
      scenarioIds: [SCENARIO_A],
      production: true,
      inventory,
    });
    expect(plan.abortDestructive).toBe(true);
    expect(plan.deleteIds).toEqual([]);
    expect(plan.skipped.every((row) => row.endsWith(":jobs-inventory-unavailable"))).toBe(true);
  });

  it("treats malformed jobs bodies as unavailable", () => {
    expect(inspectJobsInventory(200, null).available).toBe(false);
    expect(inspectJobsInventory(200, {}).available).toBe(false);
    expect(inspectJobsInventory(200, { jobs: "nope" }).available).toBe(false);
    expect(inspectJobsInventory(200, { jobs: [null] }).available).toBe(false);
    expect(inspectJobsInventory(200, { jobs: ["x"] }).available).toBe(false);

    const plan = planQaOwnedLeftoverCleanup({
      scenarioIds: [SCENARIO_A, SCENARIO_B],
      production: true,
      inventory: inspectJobsInventory(200, { jobs: "nope" }),
    });
    expect(plan.abortDestructive).toBe(true);
    expect(plan.deleteIds).toEqual([]);
  });

  it("aborts on unavailable inventory even with empty local ledger (different machine)", () => {
    // No retainScenarioEvidence — simulates another agent without the ledger.
    const plan = planQaOwnedLeftoverCleanup({
      scenarioIds: [SCENARIO_A, UNRELATED],
      production: true,
      inventory: inspectJobsInventory(503, { error: "upstream" }),
    });
    expect(plan.abortDestructive).toBe(true);
    expect(plan.deleteIds).toEqual([]);
    expect(plan.skipped).toHaveLength(2);
  });

  it("never schedules DELETE ids when production inventory cannot be established", () => {
    const cases = [
      inspectJobsInventory(503, { jobs: [] }),
      inspectJobsInventory(401, {}),
      inspectJobsInventory(200, { jobs: undefined }),
      inspectJobsInventory(200, []),
    ];
    for (const inventory of cases) {
      const plan = planQaOwnedLeftoverCleanup({
        scenarioIds: [SCENARIO_A, SCENARIO_B, UNRELATED],
        production: true,
        inventory,
      });
      expect(plan.abortDestructive).toBe(true);
      expect(plan.deleteIds).toEqual([]);
    }
  });

  it("keeps normal cleanup when inventory is valid", () => {
    retainScenarioEvidence(SCENARIO_A);
    const inventory = inspectJobsInventory(200, {
      jobs: [
        { id: "job-1", scenario_id: SCENARIO_B },
        { id: "job-2", scenario_id: null },
      ],
    });
    expect(inventory.available).toBe(true);

    const plan = planQaOwnedLeftoverCleanup({
      scenarioIds: [SCENARIO_A, SCENARIO_B, UNRELATED],
      production: true,
      inventory,
    });
    expect(plan.abortDestructive).toBe(false);
    // Retained on ledger + job-linked unknown scenario are protected; unrelated cleans up.
    expect(plan.deleteIds).toEqual([UNRELATED]);
    expect(plan.skipped).toEqual(
      expect.arrayContaining([`${SCENARIO_A}:retained-evidence`, `${SCENARIO_B}:job-linked-evidence`]),
    );
  });

  it("allows delete of released job-linked scenarios when inventory is valid", () => {
    releaseRetainedScenario(SCENARIO_B);
    const inventory = inspectJobsInventory(200, {
      jobs: [{ id: "job-1", scenario_id: SCENARIO_B }],
    });
    const plan = planQaOwnedLeftoverCleanup({
      scenarioIds: [SCENARIO_B, UNRELATED],
      production: true,
      inventory,
    });
    expect(plan.abortDestructive).toBe(false);
    expect(plan.deleteIds).toEqual([SCENARIO_B, UNRELATED]);
  });

  it("does not abort local cleanup when jobs inventory is unavailable", () => {
    const plan = planQaOwnedLeftoverCleanup({
      scenarioIds: [UNRELATED],
      production: false,
      inventory: inspectJobsInventory(503, {}),
    });
    expect(plan.abortDestructive).toBe(false);
    expect(plan.deleteIds).toEqual([UNRELATED]);
  });

  it("protects a retained Meta scenario with a local ledger", () => {
    retainScenarioEvidence(META_ID);
    expect(mayCleanupScenario(META_ID, { production: true, scenarioName: META_NAME })).toBe(false);
    const plan = planQaOwnedLeftoverCleanup({
      scenarioIds: [META_ID, UNRELATED],
      scenarioNames: { [META_ID]: META_NAME, [UNRELATED]: CLEANUP_NAME },
      production: true,
      inventory: inspectJobsInventory(200, { jobs: [] }),
    });
    expect(plan.abortDestructive).toBe(false);
    expect(plan.deleteIds).toEqual([UNRELATED]);
    expect(plan.skipped).toEqual([`${META_ID}:retained-evidence`]);
  });

  it("fail-closes Meta QA scenarios with no local ledger on another agent", () => {
    // Empty ledger — different machine/agent after a paid Meta turn.
    expect(mayCleanupScenario(META_ID)).toBe(true);
    expect(mayCleanupScenario(META_ID, { production: true, scenarioName: META_NAME })).toBe(false);
    const plan = planQaOwnedLeftoverCleanup({
      scenarioIds: [META_ID, UNRELATED],
      scenarioNames: { [META_ID]: META_NAME, [UNRELATED]: CLEANUP_NAME },
      production: true,
      inventory: inspectJobsInventory(200, { jobs: [] }),
    });
    expect(plan.abortDestructive).toBe(false);
    expect(plan.deleteIds).toEqual([UNRELATED]);
    expect(plan.skipped).toEqual([`${META_ID}:meta-qa-evidence`]);
  });

  it("allows Meta cleanup only after explicit release authorization", () => {
    releaseRetainedScenario(META_ID);
    expect(mayCleanupScenario(META_ID, { production: true, scenarioName: META_NAME })).toBe(true);
    const plan = planQaOwnedLeftoverCleanup({
      scenarioIds: [META_ID, UNRELATED],
      scenarioNames: { [META_ID]: META_NAME, [UNRELATED]: CLEANUP_NAME },
      production: true,
      inventory: inspectJobsInventory(200, { jobs: [] }),
    });
    expect(plan.deleteIds).toEqual([META_ID, UNRELATED]);
    expect(plan.skipped).toEqual([]);
  });

  it("keeps unrelated QA leftover cleanup functional alongside Meta protection", () => {
    const plan = planQaOwnedLeftoverCleanup({
      scenarioIds: [META_ID, UNRELATED, SCENARIO_A],
      scenarioNames: {
        [META_ID]: META_NAME,
        [UNRELATED]: CLEANUP_NAME,
        [SCENARIO_A]: "DRAFTY_QA_bracket_fixture",
      },
      production: true,
      inventory: inspectJobsInventory(200, { jobs: [] }),
    });
    expect(plan.deleteIds).toEqual([UNRELATED, SCENARIO_A]);
    expect(plan.skipped).toEqual([`${META_ID}:meta-qa-evidence`]);
  });
});
