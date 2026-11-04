/**
 * Durable FEM / QA evidence for production investigation.
 *
 * Written synchronously to disk so a Playwright assertion failure or process exit
 * cannot erase the submitted job id. Retained scenario ids are skipped by leftover
 * cleanup until explicitly released (DRAFTY_QA_RELEASE_RETAINED=true or release API).
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

const TMP_PATH = path.join(os.tmpdir(), "drafty-qa-fem-evidence.json");
const ARCHIVE_DIR = path.join(REPO_ROOT, "docs", "qa", "evidence");

function activeRunId(): string {
  return process.env.DRAFTY_QA_BUDGET_RUN_ID || `run-${process.pid}-${Date.now()}`;
}

function emptyFile(): EvidenceFile {
  return { runId: activeRunId(), jobs: [], retainedScenarioIds: [] };
}

function readFile(filePath: string): EvidenceFile {
  try {
    if (!fs.existsSync(filePath)) return emptyFile();
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<EvidenceFile>;
    const runId = activeRunId();
    if (!parsed || parsed.runId !== runId) return emptyFile();
    return {
      runId,
      jobs: Array.isArray(parsed.jobs) ? (parsed.jobs as FemEvidenceRecord[]) : [],
      retainedScenarioIds: Array.isArray(parsed.retainedScenarioIds)
        ? parsed.retainedScenarioIds.map(String)
        : [],
    };
  } catch {
    return emptyFile();
  }
}

function writeAtomic(filePath: string, data: EvidenceFile): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
}

function persist(data: EvidenceFile): void {
  const runId = activeRunId();
  data.runId = runId;
  writeAtomic(TMP_PATH, data);
  // Durable copy under the repo for operators (not secrets — ids and statuses only).
  writeAtomic(path.join(ARCHIVE_DIR, `fem-evidence_${runId}.json`), data);
}

function load(): EvidenceFile {
  // Prefer tmp (same process); fall back to archive if tmp was wiped but run id matches.
  const tmp = readFile(TMP_PATH);
  if (tmp.jobs.length || tmp.retainedScenarioIds.length) return tmp;
  const archive = path.join(ARCHIVE_DIR, `fem-evidence_${activeRunId()}.json`);
  return readFile(archive);
}

export function evidenceRunId(): string {
  return activeRunId();
}

export function evidencePath(): string {
  return TMP_PATH;
}

export function archiveEvidencePath(): string {
  return path.join(ARCHIVE_DIR, `fem-evidence_${activeRunId()}.json`);
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
  const data = load();
  const retain = Boolean(input.retain);
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
  if (retain && !data.retainedScenarioIds.includes(record.scenarioId)) {
    data.retainedScenarioIds.push(record.scenarioId);
  }
  persist(data);
  return record;
}

export function updateFemEvidence(
  jobId: string,
  patch: Partial<Pick<FemEvidenceRecord, "status" | "error" | "modalCallId" | "compute" | "phase" | "retain">>,
): FemEvidenceRecord | null {
  const data = load();
  const idx = data.jobs.findIndex((item) => item.jobId === jobId);
  if (idx < 0) return null;
  const next: FemEvidenceRecord = {
    ...data.jobs[idx],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  data.jobs[idx] = next;
  if (next.retain && !data.retainedScenarioIds.includes(next.scenarioId)) {
    data.retainedScenarioIds.push(next.scenarioId);
  }
  persist(data);
  return next;
}

export function retainScenarioEvidence(scenarioId: string): void {
  if (!scenarioId) return;
  const data = load();
  if (!data.retainedScenarioIds.includes(scenarioId)) {
    data.retainedScenarioIds.push(scenarioId);
  }
  for (const job of data.jobs) {
    if (job.scenarioId === scenarioId) job.retain = true;
  }
  persist(data);
}

export function releaseRetainedScenario(scenarioId: string): void {
  const data = load();
  data.retainedScenarioIds = data.retainedScenarioIds.filter((id) => id !== scenarioId);
  for (const job of data.jobs) {
    if (job.scenarioId === scenarioId) job.retain = false;
  }
  persist(data);
}

export function releaseAllRetained(): void {
  const data = load();
  data.retainedScenarioIds = [];
  for (const job of data.jobs) job.retain = false;
  persist(data);
}

export function retainedScenarioIds(): string[] {
  return [...load().retainedScenarioIds];
}

export function isScenarioRetained(scenarioId: string): boolean {
  return load().retainedScenarioIds.includes(scenarioId);
}

export function recordedFemJobs(): FemEvidenceRecord[] {
  return [...load().jobs];
}

export function clearEvidenceForTests(): void {
  writeAtomic(TMP_PATH, emptyFile());
  const archive = archiveEvidencePath();
  if (fs.existsSync(archive)) fs.unlinkSync(archive);
}

/** Whether leftover cleanup may delete this scenario (retained evidence is protected). */
export function mayCleanupScenario(scenarioId: string): boolean {
  if (process.env.DRAFTY_QA_RELEASE_RETAINED === "true") return true;
  return !isScenarioRetained(scenarioId);
}
