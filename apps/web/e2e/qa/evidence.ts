/**
 * Durable FEM / Meta QA evidence for production investigation.
 *
 * Written synchronously to disk so a Playwright assertion failure or process exit
 * cannot erase the submitted job id or Meta scenario id. Retained scenario ids
 * live in a **run-id-independent** ledger so later QA sessions (new
 * DRAFTY_QA_BUDGET_RUN_ID) still skip leftover cleanup until explicitly released.
 *
 * Meta scenarios are retained **before** the paid provider request so afterAll /
 * leftover cleanup cannot delete conversation + response metadata on a UI flake.
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

export type MetaEvidencePhase =
  | "created"
  | "invoked"
  | "provider_ok"
  | "provider_fail"
  | "offline_fallback"
  | "ui_assert_failed";

export type MetaEvidenceRecord = {
  scenarioId: string;
  scenarioName?: string;
  owner?: string;
  retain: boolean;
  recordedAt: string;
  updatedAt: string;
  phase: MetaEvidencePhase;
  runId: string;
  mode?: string | null;
  meta_turns?: number | null;
  previous_response_id?: string | null;
  usage?: Record<string, unknown> | null;
  assistantExcerpt?: string | null;
  error?: string | null;
};

type EvidenceFile = {
  runId: string;
  jobs: FemEvidenceRecord[];
  retainedScenarioIds: string[];
};

type MetaEvidenceFile = {
  runId: string;
  scenarios: MetaEvidenceRecord[];
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
  /** Production leftover cleanup uses fail-closed job / Meta-name protection. */
  production?: boolean;
  /**
   * Scenario display name (when known). Production `DRAFTY_QA_meta_*` names
   * fail-closed even without a local retention ledger or linked FEM jobs, so
   * another machine/agent cannot purge Meta evidence.
   */
  scenarioName?: string | null;
};

/** Meta QA scenarios from `qaScenarioName("meta")` — protect across agents. */
export const META_QA_SCENARIO_PREFIX = "DRAFTY_QA_meta_";

export function isDraftyQaMetaScenarioName(name: string | null | undefined): boolean {
  return String(name || "").trim().startsWith(META_QA_SCENARIO_PREFIX);
}

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
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const payload = JSON.stringify(data, null, 2);
  fs.writeFileSync(tmp, payload, "utf8");
  try {
    fs.renameSync(tmp, filePath);
  } catch {
    // Windows can EPERM on replace-via-rename when another handle exists.
    fs.writeFileSync(filePath, payload, "utf8");
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

function normalizeIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))];
}

/** Merge retention hints from a single FEM evidence archive (any run id). */
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

/** Merge retention hints from a Meta evidence archive (any run id). */
function absorbMetaEvidenceFile(
  retained: Set<string>,
  parsed: Partial<MetaEvidenceFile> | null,
): void {
  if (!parsed) return;
  for (const id of normalizeIdList(parsed.retainedScenarioIds)) retained.add(id);
  if (Array.isArray(parsed.scenarios)) {
    for (const item of parsed.scenarios as MetaEvidenceRecord[]) {
      if (item?.retain && item.scenarioId) retained.add(String(item.scenarioId));
    }
  }
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

function listMetaEvidenceArchives(): string[] {
  try {
    const dir = archiveDir();
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((name) => name.startsWith("meta-evidence_") && name.endsWith(".json"))
      .map((name) => path.join(dir, name));
  } catch {
    return [];
  }
}

function metaRunTmpPath(): string {
  return process.env.DRAFTY_QA_META_EVIDENCE_TMP || path.join(os.tmpdir(), "drafty-qa-meta-evidence.json");
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

  absorbMetaEvidenceFile(retained, readJsonFile<Partial<MetaEvidenceFile>>(metaRunTmpPath()));
  for (const archivePath of listMetaEvidenceArchives()) {
    absorbMetaEvidenceFile(retained, readJsonFile<Partial<MetaEvidenceFile>>(archivePath));
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

export function archiveMetaEvidencePath(): string {
  return path.join(archiveDir(), `meta-evidence_${activeRunId()}.json`);
}

function emptyMetaRunFile(runId = activeRunId()): MetaEvidenceFile {
  return { runId, scenarios: [], retainedScenarioIds: [] };
}

function readMetaRunFile(filePath: string, expectedRunId: string): MetaEvidenceFile {
  const parsed = readJsonFile<Partial<MetaEvidenceFile>>(filePath);
  if (!parsed || parsed.runId !== expectedRunId) return emptyMetaRunFile(expectedRunId);
  return {
    runId: expectedRunId,
    scenarios: Array.isArray(parsed.scenarios) ? (parsed.scenarios as MetaEvidenceRecord[]) : [],
    retainedScenarioIds: normalizeIdList(parsed.retainedScenarioIds),
  };
}

function loadMetaRunEvidence(): MetaEvidenceFile {
  const runId = activeRunId();
  const tmp = readMetaRunFile(metaRunTmpPath(), runId);
  if (tmp.scenarios.length) return tmp;
  return readMetaRunFile(path.join(archiveDir(), `meta-evidence_${runId}.json`), runId);
}

function persistMetaRunEvidence(data: MetaEvidenceFile): void {
  const runId = activeRunId();
  const ledger = loadLedger();
  data.runId = runId;
  data.retainedScenarioIds = [...ledger.retainedScenarioIds];
  writeAtomic(metaRunTmpPath(), data);
  // Per-run archive — never overwrite other runs' files.
  writeAtomic(path.join(archiveDir(), `meta-evidence_${runId}.json`), data);
}

/**
 * Persist a Meta QA scenario as retained **before** the paid provider request.
 * Mirrors FEM retain-at-submit so afterAll / leftover cleanup cannot erase evidence.
 */
export function recordMetaScenarioRetained(input: {
  scenarioId: string;
  scenarioName?: string;
  owner?: string;
}): MetaEvidenceRecord {
  const now = new Date().toISOString();
  const scenarioId = String(input.scenarioId || "").trim();
  if (!scenarioId) {
    throw new Error("recordMetaScenarioRetained requires scenarioId");
  }
  markRetained(scenarioId);

  const data = loadMetaRunEvidence();
  const record: MetaEvidenceRecord = {
    scenarioId,
    scenarioName: input.scenarioName,
    owner: input.owner,
    retain: true,
    recordedAt: now,
    updatedAt: now,
    phase: "created",
    runId: activeRunId(),
    mode: null,
    meta_turns: null,
    previous_response_id: null,
    usage: null,
    assistantExcerpt: null,
    error: null,
  };
  const idx = data.scenarios.findIndex((item) => item.scenarioId === scenarioId);
  if (idx >= 0) {
    data.scenarios[idx] = {
      ...data.scenarios[idx],
      ...record,
      recordedAt: data.scenarios[idx].recordedAt,
      retain: true,
    };
  } else {
    data.scenarios.push(record);
  }
  persistMetaRunEvidence(data);
  return record;
}

export function updateMetaEvidence(
  scenarioId: string,
  patch: Partial<
    Pick<
      MetaEvidenceRecord,
      | "phase"
      | "mode"
      | "meta_turns"
      | "previous_response_id"
      | "usage"
      | "assistantExcerpt"
      | "error"
      | "retain"
      | "scenarioName"
      | "owner"
    >
  >,
): MetaEvidenceRecord | null {
  const id = String(scenarioId || "").trim();
  if (!id) return null;
  const data = loadMetaRunEvidence();
  let idx = data.scenarios.findIndex((item) => item.scenarioId === id);
  if (idx < 0) {
    // Scenario may have been retained under a prior run id — still honor retain.
    if (patch.retain !== false) markRetained(id);
    const now = new Date().toISOString();
    const created: MetaEvidenceRecord = {
      scenarioId: id,
      scenarioName: patch.scenarioName,
      owner: patch.owner,
      retain: patch.retain !== false,
      recordedAt: now,
      updatedAt: now,
      phase: patch.phase || "created",
      runId: activeRunId(),
      mode: patch.mode ?? null,
      meta_turns: patch.meta_turns ?? null,
      previous_response_id: patch.previous_response_id ?? null,
      usage: patch.usage ?? null,
      assistantExcerpt: patch.assistantExcerpt ?? null,
      error: patch.error ?? null,
    };
    data.scenarios.push(created);
    persistMetaRunEvidence(data);
    return created;
  }
  const next: MetaEvidenceRecord = {
    ...data.scenarios[idx],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  if (next.retain) markRetained(next.scenarioId);
  data.scenarios[idx] = next;
  persistMetaRunEvidence(data);
  return next;
}

export function recordedMetaScenarios(): MetaEvidenceRecord[] {
  const byId = new Map<string, MetaEvidenceRecord>();
  for (const archivePath of listMetaEvidenceArchives()) {
    const parsed = readJsonFile<Partial<MetaEvidenceFile>>(archivePath);
    if (!parsed || !Array.isArray(parsed.scenarios)) continue;
    for (const item of parsed.scenarios as MetaEvidenceRecord[]) {
      if (item?.scenarioId) byId.set(String(item.scenarioId), item);
    }
  }
  const tmp = readJsonFile<Partial<MetaEvidenceFile>>(metaRunTmpPath());
  if (tmp && Array.isArray(tmp.scenarios)) {
    for (const item of tmp.scenarios as MetaEvidenceRecord[]) {
      if (item?.scenarioId) byId.set(String(item.scenarioId), item);
    }
  }
  return [...byId.values()];
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
  const meta = loadMetaRunEvidence();
  for (const item of meta.scenarios) {
    if (item.scenarioId === scenarioId) item.retain = true;
  }
  persistMetaRunEvidence(meta);
}

export function releaseRetainedScenario(scenarioId: string): void {
  markReleased(scenarioId);
  const data = loadRunEvidence();
  for (const job of data.jobs) {
    if (job.scenarioId === scenarioId) job.retain = false;
  }
  persistRunEvidence(data);
  const meta = loadMetaRunEvidence();
  for (const item of meta.scenarios) {
    if (item.scenarioId === scenarioId) item.retain = false;
  }
  persistMetaRunEvidence(meta);
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
  const meta = loadMetaRunEvidence();
  for (const item of meta.scenarios) item.retain = false;
  persistMetaRunEvidence(meta);
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
  writeAtomic(metaRunTmpPath(), emptyMetaRunFile());
  writeAtomic(ledgerTmpPath(), emptyLedger());
  writeAtomic(ledgerArchivePath(), emptyLedger());
  for (const archivePath of [...listEvidenceArchives(), ...listMetaEvidenceArchives()]) {
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
 * Fail-closed in production (unless explicitly released / DRAFTY_QA_RELEASE_RETAINED):
 * - `hasLinkedJobs` — FEM artifacts across machines without a local ledger
 * - `DRAFTY_QA_meta_*` scenario names — Meta evidence with no linked jobs
 *
 * Ordinary production API scenario deletion is unchanged; this gate is QA-only.
 */
export function mayCleanupScenario(scenarioId: string, context: CleanupContext = {}): boolean {
  if (explicitReleaseAllAuthorized()) return true;
  const ledger = loadLedger();
  if (ledger.releasedScenarioIds.includes(scenarioId)) return true;
  if (ledger.retainedScenarioIds.includes(scenarioId)) return false;
  if (context.production && context.hasLinkedJobs) return false;
  if (context.production && isDraftyQaMetaScenarioName(context.scenarioName)) return false;
  return true;
}

/** Why cleanup is blocked, or null when deletion is allowed. */
export function cleanupBlockReason(scenarioId: string, context: CleanupContext = {}): string | null {
  if (mayCleanupScenario(scenarioId, context)) return null;
  if (explicitReleaseAllAuthorized()) return null;
  const ledger = loadLedger();
  if (ledger.releasedScenarioIds.includes(scenarioId)) return null;
  if (ledger.retainedScenarioIds.includes(scenarioId)) return "retained-evidence";
  if (context.production && context.hasLinkedJobs) return "job-linked-evidence";
  if (context.production && isDraftyQaMetaScenarioName(context.scenarioName)) {
    return "meta-qa-evidence";
  }
  return "retained-evidence";
}

export type JobsInventory =
  | { available: true; linkedScenarioIds: ReadonlySet<string> }
  | { available: false; reason: string };

/**
 * Parse GET /api/v1/jobs for leftover cleanup.
 * Unavailable / unauthorized / malformed responses are never treated as "no jobs".
 */
export function inspectJobsInventory(status: number, body: unknown): JobsInventory {
  if (status === 401 || status === 403) {
    return { available: false, reason: `jobs-unauthorized:${status}` };
  }
  if (status !== 200) {
    return { available: false, reason: `jobs-unavailable:${status}` };
  }
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return { available: false, reason: "jobs-malformed:body" };
  }
  const jobs = (body as { jobs?: unknown }).jobs;
  if (!Array.isArray(jobs)) {
    return { available: false, reason: "jobs-malformed:jobs" };
  }
  const linkedScenarioIds = new Set<string>();
  for (const job of jobs) {
    if (job == null || typeof job !== "object" || Array.isArray(job)) {
      return { available: false, reason: "jobs-malformed:item" };
    }
    const sid = (job as { scenario_id?: unknown }).scenario_id;
    if (sid != null && String(sid).trim()) {
      linkedScenarioIds.add(String(sid));
    }
  }
  return { available: true, linkedScenarioIds };
}

export type LeftoverCleanupPlan = {
  /** When true, callers must not issue any scenario DELETE requests. */
  abortDestructive: boolean;
  abortReason?: string;
  deleteIds: string[];
  skipped: string[];
};

/**
 * Decide which QA-owned leftovers may be deleted.
 * Production requires a valid jobs inventory before any destructive cleanup.
 * Pass `scenarioNames` so Meta QA scenarios are protected across agents.
 */
export function planQaOwnedLeftoverCleanup(input: {
  scenarioIds: string[];
  /** Optional id → name map (required for cross-machine Meta QA protection). */
  scenarioNames?: Record<string, string>;
  production: boolean;
  inventory: JobsInventory;
}): LeftoverCleanupPlan {
  if (input.production && !input.inventory.available) {
    return {
      abortDestructive: true,
      abortReason: input.inventory.reason,
      deleteIds: [],
      skipped: input.scenarioIds.map((id) => `${id}:jobs-inventory-unavailable`),
    };
  }

  const linked = input.inventory.available ? input.inventory.linkedScenarioIds : new Set<string>();
  const names = input.scenarioNames || {};
  const deleteIds: string[] = [];
  const skipped: string[] = [];
  for (const id of input.scenarioIds) {
    const hasLinkedJobs = linked.has(id);
    const scenarioName = names[id];
    const context: CleanupContext = {
      production: input.production,
      hasLinkedJobs,
      scenarioName,
    };
    const reason = cleanupBlockReason(id, context);
    if (reason) {
      skipped.push(`${id}:${reason}`);
      continue;
    }
    deleteIds.push(id);
  }
  return { abortDestructive: false, deleteIds, skipped };
}
