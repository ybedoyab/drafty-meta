/**
 * Cross-suite paid-call budget for live QA.
 *
 * Caps Modal geometry builds, CalculiX solves, and Meta turns for one QA execution.
 * Persistence is file-backed under the OS temp dir so the counters survive module
 * re-imports within the same Playwright process, but a new process (new CLI
 * invocation) starts a fresh budget. Always run production QA with:
 *   npx playwright test --project=qa-production --workers=1 --retries=0
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type PaidKind = "modal_geometry" | "modal_fem" | "meta";

const limits: Record<PaidKind, number> = {
  modal_geometry: 1,
  modal_fem: 1,
  meta: 1,
};

type BudgetFile = {
  used: Record<PaidKind, number>;
  jobIds: string[];
  runId: string;
};

const BUDGET_PATH = path.join(os.tmpdir(), "drafty-qa-paid-budget.json");
const RUN_ID = process.env.DRAFTY_QA_BUDGET_RUN_ID || `run-${process.pid}-${Date.now()}`;

function emptyBudget(): BudgetFile {
  return {
    used: { modal_geometry: 0, modal_fem: 0, meta: 0 },
    jobIds: [],
    runId: RUN_ID,
  };
}

function readBudget(): BudgetFile {
  try {
    if (!fs.existsSync(BUDGET_PATH)) return emptyBudget();
    const parsed = JSON.parse(fs.readFileSync(BUDGET_PATH, "utf8")) as BudgetFile;
    // Only reuse state from this Playwright process / explicit run id.
    if (!parsed || parsed.runId !== RUN_ID) return emptyBudget();
    return {
      used: {
        modal_geometry: Number(parsed.used?.modal_geometry || 0),
        modal_fem: Number(parsed.used?.modal_fem || 0),
        meta: Number(parsed.used?.meta || 0),
      },
      jobIds: Array.isArray(parsed.jobIds) ? parsed.jobIds.map(String) : [],
      runId: RUN_ID,
    };
  } catch {
    return emptyBudget();
  }
}

function writeBudget(budget: BudgetFile): void {
  const dir = path.dirname(BUDGET_PATH);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${BUDGET_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(budget, null, 2), "utf8");
  fs.renameSync(tmp, BUDGET_PATH);
}

/** Reset budget for a new intentional QA session (call from CLI wrapper only). */
export function resetPaidBudget(): void {
  writeBudget(emptyBudget());
}

export function budgetSnapshot(): Record<PaidKind, number> {
  return { ...readBudget().used };
}

export function remaining(kind: PaidKind): number {
  const used = readBudget().used[kind] || 0;
  return Math.max(0, limits[kind] - used);
}

/**
 * Atomically reserve one paid slot. Returns false if exhausted.
 * Consumed slots are never released — failed paid attempts still count.
 */
export function tryConsume(kind: PaidKind): boolean {
  const budget = readBudget();
  const used = budget.used[kind] || 0;
  if (used >= limits[kind]) return false;
  budget.used[kind] = used + 1;
  budget.runId = RUN_ID;
  writeBudget(budget);
  return true;
}

export function recordJobId(jobId: string): void {
  if (!jobId) return;
  const budget = readBudget();
  if (!budget.jobIds.includes(jobId)) {
    budget.jobIds.push(jobId);
    writeBudget(budget);
  }
}

export function recordedJobIds(): string[] {
  return [...readBudget().jobIds];
}

export function budgetRunId(): string {
  return RUN_ID;
}

export function budgetLimits(): Record<PaidKind, number> {
  return { ...limits };
}
