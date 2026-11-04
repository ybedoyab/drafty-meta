/**
 * Durable FEM / QA evidence for production investigation.
 *
 * Written synchronously to disk so a Playwright assertion failure or process exit
 * cannot erase the submitted job id. Retained scenario ids live in a **run-id-
 * independent** ledger so later QA sessions (new DRAFTY_QA_BUDGET_RUN_ID) still
 * skip leftover cleanup until explicitly released.
 *
 * Release authorization (any one):
 * - DRAFTY_QA_RELEASE_RETAINED=true (all retained)
 * - releaseRetainedScenario(id) / releaseAllRetained()
 *
 * Local ledger is gitignored; production leftover cleanup also fail-closes on
 * scenarios that still have linked FEM jobs when no release was recorded here
 * (protects evidence across machines/agents without weakening ownership checks).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { REPO_ROOT } from "./env";

export type FemEvidenceRecord = {
  jobId: string;
  scenarioId: string;
  scenarioName?: string;
  compute?: string | null;
  status?: string | null;
  error?: string | null;
  modalCallId?: string | null;
  retain: boolean;
  recordedAt: string;
  updatedAt: string;
  phase: "submitted" | "terminal" | "failed" | "reports_ok";
  runId: string;
};

type EvidenceFile = {
  runId: string;
  jobs: FemEvidenceRecord[];
  retainedScenarioIds: string[];
};

type RetentionLedger = {
  /** Scenarios that must not be auto-deleted. */
  retainedScenarioIds: string[];
  /** Scenarios explicitly authorized for cleanup (survives across runs). */
  releasedScenarioIds: string[];
  updatedAt: string;
};

export type CleanupContext = {
  /** True when GET /api/v1/jobs lists at least one job for this scenario. */
  hasLinkedJobs?: boolean;
  /** Production leftover cleanup uses fail-closed job protection. */
  production?: boolean;
};

function archiveDir(): string {
  return (
    process.env.DRAFTY_QA_EVIDENCE_DIR || path.join(REPO_ROOT, "docs", "qa", "evidence")
  );
}

function runTmpPath(): string {
  return process.env.DRAFTY_QA_EVIDENCE_TMP || path.join(os.tmpdir(), "drafty-qa-fem-evidence.json");
}

function ledgerTmpPath(): string {
  return (
    process.env.DRAFTY_QA_RETENTION_TMP || path.join(os.tmpdir(), "drafty-qa-retained-scenarios.json")
  );
}

function ledgerArchivePath(): string {
  return path.join(archiveDir(), "retained-scenarios.json");
}

function activeRunId(): string {
  return process.env.DRAFTY_QA_BUDGET_RUN_ID || `run-${process.pid}-${Date.now()}`;
}

function explicitReleaseAllAuthorized(): boolean {
  return process.env.DRAFTY_QA_RELEASE_RETAINED === "true";
}

function emptyRunFile(runId = activeRunId()): EvidenceFile {
  return { runId, jobs: [], retainedScenarioIds: [] };
}

function emptyLedger(): RetentionLedger {
  return { retainedScenarioIds: [], releasedScenarioIds: [], updatedAt: new Date().toISOString() };
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeAtomic(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
}

function normalizeIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))];
}

/** Merge retention hints from a single evidence archive (any run id). */
function absorbEvidenceFile(
  retained: Set<string>,
  released: Set<string>,
  parsed: Partial<EvidenceFile> | null,
): void {
  if (!parsed) return;
  for (const id of normalizeIdList(parsed.retainedScenarioIds)) retained.add(id);
  if (Array.isArray(parsed.jobs)) {
    for (const job of parsed.jobs as FemEvidenceRecord[]) {
      if (job?.retain && job.scenarioId) retained.add(String(job.scenarioId));
    }
  }
  // Historical files never stored releases; no-op for released.
  void released;
}

function listEvidenceArchives(): string[] {
  try {
    const dir = archiveDir();
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((name) => name.startsWith("fem-evidence_") && name.endsWith(".json"))
      .map((name) => path.join(dir, name));
  } catch {
    return [];
  }
}

/**
 * Load the global retention ledger, unioning every durable source so a new
 * run id / process restart cannot forget prior retained FEM scenarios.
 */
function loadLedger(): RetentionLedger {
  const retained = new Set<string>();
  const released = new Set<string>();

  for (const filePath of [ledgerTmpPath(), ledgerArchivePath()]) {
    const parsed = readJsonFile<Partial<RetentionLedger>>(filePath);
    if (!parsed) continue;
    for (const id of normalizeIdList(parsed.retainedScenarioIds)) retained.add(id);
    for (const id of normalizeIdList(parsed.releasedScenarioIds)) released.add(id);
  }

  const runTmp = readJsonFile<Partial<EvidenceFile>>(runTmpPath());
  absorbEvidenceFile(retained, released, runTmp);

  for (const archivePath of listEvidenceArchives()) {
    absorbEvidenceFile(retained, released, readJsonFile<Partial<EvidenceFile>>(archivePath));
  }

  // Explicit release wins over retain if both somehow appear.
  for (const id of released) retained.delete(id);

  return {
    retainedScenarioIds: [...retained],
    releasedScenarioIds: [...released],
    updatedAt: new Date().toISOString(),
  };
}

function persistLedger(ledger: RetentionLedger): void {
  const retainedScenarioIds = normalizeIdList(ledger.retainedScenarioIds);
  const releasedScenarioIds = normalizeIdList(ledger.releasedScenarioIds).filter(
    (id) => !retainedScenarioIds.includes(id),
  );
  const next: RetentionLedger = {
    retainedScenarioIds,
    releasedScenarioIds,
    updatedAt: new Date().toISOString(),
  };
  writeAtomic(ledgerTmpPath(), next);
  writeAtomic(ledgerArchivePath(), next);
}

function readRunFile(filePath: string, expectedRunId: string): EvidenceFile {
  const parsed = readJsonFile<Partial<EvidenceFile>>(filePath);
  if (!parsed || parsed.runId !== expectedRunId) return emptyRunFile(expectedRunId);
  return {
    runId: expectedRunId,
    jobs: Array.isArray(parsed.jobs) ? (parsed.jobs as FemEvidenceRecord[]) : [],
    retainedScenarioIds: normalizeIdList(parsed.retainedScenarioIds),
  };
}

function loadRunEvidence(): EvidenceFile {
  const runId = activeRunId();
  const tmp = readRunFile(runTmpPath(), runId);
  if (tmp.jobs.length) return tmp;
  return readRunFile(path.join(archiveDir(), `fem-evidence_${runId}.json`), runId);
}

function persistRunEvidence(data: EvidenceFile): void {
  const runId = activeRunId();
  const ledger = loadLedger();
  data.runId = runId;
  data.retainedScenarioIds = [...ledger.retainedScenarioIds];
  writeAtomic(runTmpPath(), data);
  // Per-run archive — never overwrite other runs' files.
  writeAtomic(path.join(archiveDir(), `fem-evidence_${runId}.json`), data);
}

function markRetained(scenarioId: string): void {
  if (!scenarioId) return;
  const ledger = loadLedger();
  ledger.releasedScenarioIds = ledger.releasedScenarioIds.filter((id) => id !== scenarioId);
  if (!ledger.retainedScenarioIds.includes(scenarioId)) {
    ledger.retainedScenarioIds.push(scenarioId);
  }
  persistLedger(ledger);
}

function markReleased(scenarioId: string): void {
  if (!scenarioId) return;
  const ledger = loadLedger();
  ledger.retainedScenarioIds = ledger.retainedScenarioIds.filter((id) => id !== scenarioId);
  if (!ledger.releasedScenarioIds.includes(scenarioId)) {
    ledger.releasedScenarioIds.push(scenarioId);
  }
  persistLedger(ledger);
}

export function evidenceRunId(): string {
  return activeRunId();
}

export function evidencePath(): string {
  return runTmpPath();
}

export function retentionLedgerPath(): string {
  return ledgerArchivePath();
}

export function archiveEvidencePath(): string {
  return path.join(archiveDir(), `fem-evidence_${activeRunId()}.json`);
}

/** Record a FEM job as soon as POST /jobs succeeds (before poll / reports). */
export function recordFemJobSubmitted(input: {
  jobId: string;
  scenarioId: string;
  scenarioName?: string;
  compute?: string | null;
  status?: string | null;
  modalCallId?: string | null;
  retain?: boolean;
}): FemEvidenceRecord {
  const now = new Date().toISOString();
  const retain = Boolean(input.retain);
  if (retain) markRetained(String(input.scenarioId));

  const data = loadRunEvidence();
  const record: FemEvidenceRecord = {
    jobId: String(input.jobId),
    scenarioId: String(input.scenarioId),
    scenarioName: input.scenarioName,
    compute: input.compute ?? null,
    status: input.status ?? "submitted",
    error: null,
    modalCallId: input.modalCallId ?? null,
    retain,
    recordedAt: now,
    updatedAt: now,
    phase: "submitted",
    runId: activeRunId(),
  };
  const idx = data.jobs.findIndex((item) => item.jobId === record.jobId);
  if (idx >= 0) data.jobs[idx] = { ...data.jobs[idx], ...record, recordedAt: data.jobs[idx].recordedAt };
  else data.jobs.push(record);
  persistRunEvidence(data);
  return record;
}

export function updateFemEvidence(
  jobId: string,
  patch: Partial<Pick<FemEvidenceRecord, "status" | "error" | "modalCallId" | "compute" | "phase" | "retain">>,
): FemEvidenceRecord | null {
  const data = loadRunEvidence();
  const idx = data.jobs.findIndex((item) => item.jobId === jobId);
  if (idx < 0) {
    // Job may have been recorded under a prior run id — still honor retain patches.
    if (patch.retain) {
      const prior = recordedFemJobs().find((job) => job.jobId === jobId);
      if (prior?.scenarioId) markRetained(prior.scenarioId);
    }
    return null;
  }
  const next: FemEvidenceRecord = {
    ...data.jobs[idx],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  data.jobs[idx] = next;
  if (next.retain) markRetained(next.scenarioId);
  persistRunEvidence(data);
  return next;
}

export function retainScenarioEvidence(scenarioId: string): void {
  markRetained(scenarioId);
  const data = loadRunEvidence();
  for (const job of data.jobs) {
    if (job.scenarioId === scenarioId) job.retain = true;
  }
  persistRunEvidence(data);
}

export function releaseRetainedScenario(scenarioId: string): void {
  markReleased(scenarioId);
  const data = loadRunEvidence();
  for (const job of data.jobs) {
    if (job.scenarioId === scenarioId) job.retain = false;
  }
  persistRunEvidence(data);
}

export function releaseAllRetained(): void {
  const ledger = loadLedger();
  for (const id of ledger.retainedScenarioIds) {
    if (!ledger.releasedScenarioIds.includes(id)) ledger.releasedScenarioIds.push(id);
  }
  ledger.retainedScenarioIds = [];
  persistLedger(ledger);
  const data = loadRunEvidence();
  for (const job of data.jobs) job.retain = false;
  persistRunEvidence(data);
}

export function retainedScenarioIds(): string[] {
  if (explicitReleaseAllAuthorized()) return [];
  return [...loadLedger().retainedScenarioIds];
}

/**
 * Whether this scenario is currently protected from cleanup.
 * Honors DRAFTY_QA_RELEASE_RETAINED and per-scenario release records.
 */
export function isScenarioRetained(scenarioId: string): boolean {
  if (!scenarioId) return false;
  if (explicitReleaseAllAuthorized()) return false;
  const ledger = loadLedger();
  if (ledger.releasedScenarioIds.includes(scenarioId)) return false;
  return ledger.retainedScenarioIds.includes(scenarioId);
}

export function recordedFemJobs(): FemEvidenceRecord[] {
  // Union current run + all archives so diagnostics survive run-id changes.
  const byId = new Map<string, FemEvidenceRecord>();
  for (const archivePath of listEvidenceArchives()) {
    const parsed = readJsonFile<Partial<EvidenceFile>>(archivePath);
    if (!parsed || !Array.isArray(parsed.jobs)) continue;
    for (const job of parsed.jobs as FemEvidenceRecord[]) {
      if (job?.jobId) byId.set(String(job.jobId), job);
    }
  }
  const tmp = readJsonFile<Partial<EvidenceFile>>(runTmpPath());
  if (tmp && Array.isArray(tmp.jobs)) {
    for (const job of tmp.jobs as FemEvidenceRecord[]) {
      if (job?.jobId) byId.set(String(job.jobId), job);
    }
  }
  return [...byId.values()];
}

export function clearEvidenceForTests(): void {
  writeAtomic(runTmpPath(), emptyRunFile());
  writeAtomic(ledgerTmpPath(), emptyLedger());
  writeAtomic(ledgerArchivePath(), emptyLedger());
  for (const archivePath of listEvidenceArchives()) {
    try {
      fs.unlinkSync(archivePath);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Single cleanup gate used by cleanupTracked and cleanupQaOwnedLeftovers.
 * Default: preserve retained evidence. Require explicit release to delete it.
 *
 * When `context.production && context.hasLinkedJobs`, also fail-closed unless
 * this scenario was explicitly released (or DRAFTY_QA_RELEASE_RETAINED=true),
 * so another machine/agent without the local ledger cannot purge FEM artifacts.
 */
export function mayCleanupScenario(scenarioId: string, context: CleanupContext = {}): boolean {
  if (explicitReleaseAllAuthorized()) return true;
  const ledger = loadLedger();
  if (ledger.releasedScenarioIds.includes(scenarioId)) return true;
  if (ledger.retainedScenarioIds.includes(scenarioId)) return false;
  if (context.production && context.hasLinkedJobs) return false;
  return true;
}
