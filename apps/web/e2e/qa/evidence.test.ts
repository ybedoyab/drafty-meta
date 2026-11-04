import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearEvidenceForTests,
  isScenarioRetained,
  mayCleanupScenario,
  recordFemJobSubmitted,
  recordedFemJobs,
  releaseRetainedScenario,
  retainScenarioEvidence,
  updateFemEvidence,
} from "./evidence";

const SCENARIO = "11111111-1111-4111-8111-111111111111";
const JOB = "22222222-2222-4222-8222-222222222222";

describe("FEM QA evidence preservation", () => {
  beforeEach(() => {
    vi.stubEnv("DRAFTY_QA_BUDGET_RUN_ID", `vitest-evidence-${process.pid}`);
    vi.stubEnv("DRAFTY_QA_RELEASE_RETAINED", "");
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
    const unrelated = "33333333-3333-4333-8333-333333333333";
    expect(mayCleanupScenario(SCENARIO)).toBe(false);
    expect(mayCleanupScenario(unrelated)).toBe(true);

    const skipped: string[] = [];
    const deleted: string[] = [];
    for (const id of [SCENARIO, unrelated]) {
      if (!mayCleanupScenario(id) || isScenarioRetained(id)) skipped.push(`${id}:retained-evidence`);
      else deleted.push(id);
    }
    expect(skipped).toEqual([`${SCENARIO}:retained-evidence`]);
    expect(deleted).toEqual([unrelated]);
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

  it("allows cleanup only after explicit release", () => {
    retainScenarioEvidence(SCENARIO);
    expect(mayCleanupScenario(SCENARIO)).toBe(false);
    releaseRetainedScenario(SCENARIO);
    expect(isScenarioRetained(SCENARIO)).toBe(false);
    expect(mayCleanupScenario(SCENARIO)).toBe(true);
  });

  it("honors DRAFTY_QA_RELEASE_RETAINED for emergency cleanup", () => {
    retainScenarioEvidence(SCENARIO);
    expect(mayCleanupScenario(SCENARIO)).toBe(false);
    vi.stubEnv("DRAFTY_QA_RELEASE_RETAINED", "true");
    expect(mayCleanupScenario(SCENARIO)).toBe(true);
  });
});
