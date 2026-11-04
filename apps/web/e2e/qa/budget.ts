/**
 * Cross-suite paid-call budget for live QA.
 *
 * Caps Modal geometry builds, CalculiX solves, and Meta turns for one QA execution.
 * Persistence is file-backed under the OS temp dir so the counters survive module
 * re-imports within the same Playwright process, but a new process (new CLI
 * invocation) starts a fresh budget. Always run production QA with:
 *   npx playwright test --project=qa-production --workers=1 --retries=0
 *
 * Accounting layers (kept separate on purpose):
 * - reservations: slots reserved before a paid attempt (safety cap)
 * - invocation_attempts: provider/API calls that were actually started
 * - completed_responses: provider responses that finished successfully
 * - billing: optional measured cost fields when available
 *
 * `used` mirrors `reservations` for backward-compatible report snapshots.
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

type Counters = Record<PaidKind, number>;

type BudgetFile = {
  used: Counters;
  reservations: Counters;
  invocation_attempts: Counters;
  completed_responses: Counters;
  billing: Record<string, unknown>;
  jobIds: string[];
  runId: string;
};

const BUDGET_PATH = path.join(os.tmpdir(), "drafty-qa-paid-budget.json");
const RUN_ID = process.env.DRAFTY_QA_BUDGET_RUN_ID || `run-${process.pid}-${Date.now()}`;

function emptyCounters(): Counters {
  return { modal_geometry: 0, modal_fem: 0, meta: 0 };
}

function emptyBudget(): BudgetFile {
  return {
    used: emptyCounters(),
    reservations: emptyCounters(),
    invocation_attempts: emptyCounters(),
    completed_responses: emptyCounters(),
    billing: {},
    jobIds: [],
    runId: RUN_ID,
  };
}

function normalizeCounters(raw: Partial<Counters> | undefined): Counters {
  return {
    modal_geometry: Number(raw?.modal_geometry || 0),
    modal_fem: Number(raw?.modal_fem || 0),
    meta: Number(raw?.meta || 0),
  };
}

function readBudget(): BudgetFile {
  try {
    if (!fs.existsSync(BUDGET_PATH)) return emptyBudget();
    const parsed = JSON.parse(fs.readFileSync(BUDGET_PATH, "utf8")) as Partial<BudgetFile>;
    // Only reuse state from this Playwright process / explicit run id.
    if (!parsed || parsed.runId !== RUN_ID) return emptyBudget();
    const reservations = normalizeCounters(parsed.reservations ?? parsed.used);
    return {
      used: { ...reservations },
      reservations,
      invocation_attempts: normalizeCounters(parsed.invocation_attempts),
      completed_responses: normalizeCounters(parsed.completed_responses),
      billing: parsed.billing && typeof parsed.billing === "object" ? { ...parsed.billing } : {},
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
  // Keep `used` aligned with reservations for older report readers.
  budget.used = { ...budget.reservations };
  fs.writeFileSync(tmp, JSON.stringify(budget, null, 2), "utf8");
  fs.renameSync(tmp, BUDGET_PATH);
}

/** Reset budget for a new intentional QA session (call from CLI wrapper only). */
export function resetPaidBudget(): void {
  writeBudget(emptyBudget());
}

export function budgetSnapshot(): Counters {
  return { ...readBudget().reservations };
}

export function budgetAccounting(): {
  reservations: Counters;
  invocation_attempts: Counters;
  completed_responses: Counters;
  billing: Record<string, unknown>;
} {
  const budget = readBudget();
  return {
    reservations: { ...budget.reservations },
    invocation_attempts: { ...budget.invocation_attempts },
    completed_responses: { ...budget.completed_responses },
    billing: { ...budget.billing },
  };
}

export function remaining(kind: PaidKind): number {
  const used = readBudget().reservations[kind] || 0;
  return Math.max(0, limits[kind] - used);
}

/**
 * Atomically reserve one paid slot. Returns false if exhausted.
 * Consumed slots are never released — failed paid attempts still count.
 */
export function tryConsume(kind: PaidKind): boolean {
  const budget = readBudget();
  const used = budget.reservations[kind] || 0;
  if (used >= limits[kind]) return false;
  budget.reservations[kind] = used + 1;
  budget.runId = RUN_ID;
  writeBudget(budget);
  return true;
}

/** Record that a provider/API invocation was actually started after reservation. */
export function recordInvocationAttempt(kind: PaidKind): void {
  const budget = readBudget();
  budget.invocation_attempts[kind] = (budget.invocation_attempts[kind] || 0) + 1;
  budget.runId = RUN_ID;
  writeBudget(budget);
}

/** Record a completed provider response (not merely a reservation). */
export function recordCompletedResponse(kind: PaidKind): void {
  const budget = readBudget();
  budget.completed_responses[kind] = (budget.completed_responses[kind] || 0) + 1;
  budget.runId = RUN_ID;
  writeBudget(budget);
}

/** Optional measured billing fields when a provider exposes them. */
export function recordBilling(fields: Record<string, unknown>): void {
  if (!fields || typeof fields !== "object") return;
  const budget = readBudget();
  budget.billing = { ...budget.billing, ...fields };
  budget.runId = RUN_ID;
  writeBudget(budget);
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
