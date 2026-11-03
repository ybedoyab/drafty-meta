/**
 * Cross-suite paid-call budget for live QA.
 * Caps Modal geometry builds, CalculiX solves, and Meta turns for the whole process.
 */
export type PaidKind = "modal_geometry" | "modal_fem" | "meta";

const limits: Record<PaidKind, number> = {
  modal_geometry: 1,
  modal_fem: 1,
  meta: 1,
};

const used: Record<PaidKind, number> = {
  modal_geometry: 0,
  modal_fem: 0,
  meta: 0,
};

const jobIds: string[] = [];

export function budgetSnapshot(): Record<PaidKind, number> {
  return { ...used };
}

export function remaining(kind: PaidKind): number {
  return Math.max(0, limits[kind] - used[kind]);
}

/** Reserve one paid slot. Returns false if the budget is exhausted. */
export function tryConsume(kind: PaidKind): boolean {
  if (used[kind] >= limits[kind]) return false;
  used[kind] += 1;
  return true;
}

export function recordJobId(jobId: string): void {
  if (jobId && !jobIds.includes(jobId)) jobIds.push(jobId);
}

export function recordedJobIds(): string[] {
  return [...jobIds];
}
