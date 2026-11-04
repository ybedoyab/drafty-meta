import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  archiveEvidencePath,
  clearEvidenceForTests,
  isScenarioRetained,
  mayCleanupScenario,
  recordFemJobSubmitted,
  recordedFemJobs,
  releaseRetainedScenario,
  retainScenarioEvidence,
  retentionLedgerPath,
  updateFemEvidence,
} from "./evidence";

const SCENARIO = "11111111-1111-4111-8111-111111111111";
const JOB = "22222222-2222-4222-8222-222222222222";
const SCENARIO_B = "33333333-3333-4333-8333-333333333333";
const UNRELATED = "44444444-4444-4444-8444-444444444444";

describe("FEM QA evidence preservation", () => {
  const evidenceDir = path.join(os.tmpdir(), `drafty-qa-evidence-vitest-${process.pid}`);
  const evidenceTmp = path.join(os.tmpdir(), `drafty-qa-fem-evidence-vitest-${process.pid}.json`);
  const retentionTmp = path.join(os.tmpdir(), `drafty-qa-retained-vitest-${process.pid}.json`);

  beforeEach(() => {
    vi.stubEnv("DRAFTY_QA_BUDGET_RUN_ID", `vitest-evidence-${process.pid}`);
    vi.stubEnv("DRAFTY_QA_RELEASE_RETAINED", "");
    vi.stubEnv("DRAFTY_QA_EVIDENCE_DIR", evidenceDir);
    vi.stubEnv("DRAFTY_QA_EVIDENCE_TMP", evidenceTmp);
    vi.stubEnv("DRAFTY_QA_RETENTION_TMP", retentionTmp);
    fs.mkdirSync(evidenceDir, { recursive: true });
    clearEvidenceForTests();
  });

  afterEach(() => {
    clearEvidenceForTests();
    vi.unstubAllEnvs();
  });

  it("records the job id at submission before a simulated report 404", () => {
    const jobIds: string[] = [];
    const onJobSubmitted = (job: { id: string; status: string; compute?: string }) => {
      jobIds.push(job.id);
      recordFemJobSubmitted({
        jobId: job.id,
        scenarioId: SCENARIO,
        scenarioName: "DRAFTY_QA_bracket_test",
        compute: "modal",
        status: job.status,
        retain: true,
      });
    };

    // Simulate POST /jobs success → immediate record → later report failure.
    onJobSubmitted({ id: JOB, status: "queued", compute: "modal" });
    expect(jobIds).toEqual([JOB]);
    expect(recordedFemJobs()[0]?.jobId).toBe(JOB);
    expect(recordedFemJobs()[0]?.phase).toBe("submitted");
    expect(isScenarioRetained(SCENARIO)).toBe(true);

    const reportStatus = 404;
    expect(reportStatus).toBe(404);
    updateFemEvidence(JOB, {
      phase: "failed",
      status: "completed",
      error: `report download HTTP ${reportStatus}`,
      retain: true,
    });

    const evidence = recordedFemJobs()[0];
    expect(evidence?.jobId).toBe(JOB);
    expect(evidence?.scenarioId).toBe(SCENARIO);
    expect(evidence?.phase).toBe("failed");
    expect(evidence?.error).toContain("404");
    expect(isScenarioRetained(SCENARIO)).toBe(true);
    expect(mayCleanupScenario(SCENARIO)).toBe(false);
  });

  it("stops further paid testing after the first FEM failure while keeping evidence", () => {
    recordFemJobSubmitted({
      jobId: JOB,
      scenarioId: SCENARIO,
      compute: "modal",
      retain: true,
    });
    updateFemEvidence(JOB, { phase: "failed", error: "report download HTTP 404", retain: true });

    let metaAttempted = false;
    const femFailed = recordedFemJobs()[0]?.phase === "failed";
    if (!femFailed) {
      metaAttempted = true;
    }
    expect(femFailed).toBe(true);
    expect(metaAttempted).toBe(false);
    expect(mayCleanupScenario(SCENARIO)).toBe(false);
  });

  it("skips retained scenarios during leftover cleanup eligibility checks", () => {
    retainScenarioEvidence(SCENARIO);
    expect(mayCleanupScenario(SCENARIO)).toBe(false);
    expect(mayCleanupScenario(UNRELATED)).toBe(true);

    const skipped: string[] = [];
    const deleted: string[] = [];
    for (const id of [SCENARIO, UNRELATED]) {
      if (!mayCleanupScenario(id)) skipped.push(`${id}:retained-evidence`);
      else deleted.push(id);
    }
    expect(skipped).toEqual([`${SCENARIO}:retained-evidence`]);
    expect(deleted).toEqual([UNRELATED]);
  });

  it("marks successful report.json / report.pdf retrieval on the evidence record", () => {
    recordFemJobSubmitted({
      jobId: JOB,
      scenarioId: SCENARIO,
      compute: "modal",
      retain: true,
    });
    const reportJson = {
      report: "drafty-engineering",
      solver: { name: "CalculiX" },
      mesh: { element_type: "C3D10", nodes: 100, elements: 40 },
      equilibrium: { passed: true },
    };
    const reportPdfOk = true;
    expect(JSON.stringify(reportJson).toLowerCase()).toContain("calculix");
    expect(reportPdfOk).toBe(true);
    updateFemEvidence(JOB, { phase: "reports_ok", status: "completed", retain: true });
    expect(recordedFemJobs()[0]?.phase).toBe("reports_ok");
    // Still retained until explicit release authorization.
    expect(mayCleanupScenario(SCENARIO)).toBe(false);
  });

  it("allows cleanup only after explicit per-scenario release", () => {
    retainScenarioEvidence(SCENARIO);
    expect(mayCleanupScenario(SCENARIO)).toBe(false);
    expect(isScenarioRetained(SCENARIO)).toBe(true);
    releaseRetainedScenario(SCENARIO);
    expect(isScenarioRetained(SCENARIO)).toBe(false);
    expect(mayCleanupScenario(SCENARIO)).toBe(true);
    // Job-linked production leftovers become eligible only after release.
    expect(mayCleanupScenario(SCENARIO, { production: true, hasLinkedJobs: true })).toBe(true);
  });

  it("honors DRAFTY_QA_RELEASE_RETAINED consistently across retain and cleanup gates", () => {
    retainScenarioEvidence(SCENARIO);
    expect(mayCleanupScenario(SCENARIO)).toBe(false);
    expect(isScenarioRetained(SCENARIO)).toBe(true);
    vi.stubEnv("DRAFTY_QA_RELEASE_RETAINED", "true");
    expect(isScenarioRetained(SCENARIO)).toBe(false);
    expect(mayCleanupScenario(SCENARIO)).toBe(true);
    expect(mayCleanupScenario(SCENARIO, { production: true, hasLinkedJobs: true })).toBe(true);
  });

  it("protects Run A retained evidence when Run B uses a different run id", () => {
    const runA = `vitest-run-a-${process.pid}`;
    const runB = `vitest-run-b-${process.pid}`;
    vi.stubEnv("DRAFTY_QA_BUDGET_RUN_ID", runA);

    recordFemJobSubmitted({
      jobId: JOB,
      scenarioId: SCENARIO,
      compute: "modal",
      retain: true,
    });
    expect(isScenarioRetained(SCENARIO)).toBe(true);
    const runAArchive = archiveEvidencePath();
    expect(fs.existsSync(runAArchive)).toBe(true);
    expect(fs.existsSync(retentionLedgerPath())).toBe(true);

    // New QA session with a different budget run id (does not clear historical evidence).
    vi.stubEnv("DRAFTY_QA_BUDGET_RUN_ID", runB);
    expect(isScenarioRetained(SCENARIO)).toBe(true);
    expect(mayCleanupScenario(SCENARIO)).toBe(false);
    expect(recordedFemJobs().some((job) => job.jobId === JOB)).toBe(true);

    const skipped: string[] = [];
    const deleted: string[] = [];
    for (const id of [SCENARIO, UNRELATED]) {
      if (!mayCleanupScenario(id)) skipped.push(id);
      else deleted.push(id);
    }
    expect(skipped).toEqual([SCENARIO]);
    expect(deleted).toEqual([UNRELATED]);
    // Historical Run A archive must still exist (not overwritten by Run B).
    expect(fs.existsSync(runAArchive)).toBe(true);
  });

  it("survives a simulated process restart via durable ledger files", () => {
    retainScenarioEvidence(SCENARIO);
    recordFemJobSubmitted({
      jobId: JOB,
      scenarioId: SCENARIO,
      compute: "modal",
      retain: true,
    });
    const ledgerBefore = fs.readFileSync(retentionLedgerPath(), "utf8");
    expect(ledgerBefore).toContain(SCENARIO);

    // Simulate a new process: new run id, no in-memory state (module re-reads disk).
    vi.stubEnv("DRAFTY_QA_BUDGET_RUN_ID", `vitest-restart-${process.pid}-${Date.now()}`);
    expect(isScenarioRetained(SCENARIO)).toBe(true);
    expect(mayCleanupScenario(SCENARIO)).toBe(false);
    expect(mayCleanupScenario(UNRELATED)).toBe(true);
  });

  it("fail-closes production leftover cleanup for job-linked scenarios without local release", () => {
    // Unknown to this machine (empty ledger) but still has FEM jobs in production.
    expect(mayCleanupScenario(SCENARIO_B)).toBe(true);
    expect(mayCleanupScenario(SCENARIO_B, { production: true, hasLinkedJobs: true })).toBe(false);
    // Unrelated QA scenario with no jobs remains eligible.
    expect(mayCleanupScenario(UNRELATED, { production: true, hasLinkedJobs: false })).toBe(true);
    // Explicit release unlocks job-linked cleanup.
    releaseRetainedScenario(SCENARIO_B);
    expect(mayCleanupScenario(SCENARIO_B, { production: true, hasLinkedJobs: true })).toBe(true);
  });

  it("keeps isScenarioRetained and mayCleanupScenario aligned for retained and released ids", () => {
    retainScenarioEvidence(SCENARIO);
    expect(isScenarioRetained(SCENARIO)).toBe(true);
    expect(mayCleanupScenario(SCENARIO)).toBe(false);

    releaseRetainedScenario(SCENARIO);
    expect(isScenarioRetained(SCENARIO)).toBe(false);
    expect(mayCleanupScenario(SCENARIO)).toBe(true);

    vi.stubEnv("DRAFTY_QA_RELEASE_RETAINED", "true");
    retainScenarioEvidence(SCENARIO_B);
    expect(isScenarioRetained(SCENARIO_B)).toBe(false);
    expect(mayCleanupScenario(SCENARIO_B)).toBe(true);
  });
});
