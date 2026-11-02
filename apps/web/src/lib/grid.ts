/** Measured-grid scale presets for the 3D views. One grid cell equals one step. */
export const GRID_STEPS_MM = [1, 5, 10, 50, 100] as const;

export type GridStepMm = (typeof GRID_STEPS_MM)[number];

export const DEFAULT_GRID_STEP_MM: GridStepMm = 10;

/** Short badge label, e.g. 1 mm, 5 mm, 1 cm, 5 cm, 10 cm. */
export function gridStepLabel(stepMm: number): string {
  if (stepMm >= 10 && stepMm % 10 === 0) return `${stepMm / 10} cm`;
  return `${stepMm} mm`;
}

/** Cell size in meters, the unit the 3D view renders in. */
export function gridStepMeters(stepMm: number): number {
  return stepMm / 1000;
}

/**
 * Distance from the part center to the grid plane, in meters.
 * The first finite positive candidate wins: a measured half-height beats an
 * assumed one, so the part rests on the grid instead of floating above it.
 */
export function resolveGridFloor(
  candidates: ReadonlyArray<number | null | undefined>,
  fallback: number,
): number {
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0) return candidate;
  }
  return fallback;
}
