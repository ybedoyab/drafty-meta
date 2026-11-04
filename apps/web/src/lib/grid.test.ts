import { describe, expect, it } from "vitest";
import {
  DEFAULT_GRID_STEP_MM,
  GRID_STEPS_MM,
  gridStepLabel,
  gridStepMeters,
  gridPlaneDistance,
  resolveGridFloor,
} from "@/lib/grid";

describe("measured grid steps", () => {
  it("offers millimetre and centimetre cells", () => {
    expect([...GRID_STEPS_MM]).toEqual([1, 5, 10, 50, 100]);
    expect(GRID_STEPS_MM).toContain(DEFAULT_GRID_STEP_MM);
  });

  it("labels cells the way the popup shows them", () => {
    expect(gridStepLabel(1)).toBe("1 mm");
    expect(gridStepLabel(5)).toBe("5 mm");
    expect(gridStepLabel(10)).toBe("1 cm");
    expect(gridStepLabel(50)).toBe("5 cm");
    expect(gridStepLabel(100)).toBe("10 cm");
  });

  it("converts the cell to viewer meters", () => {
    expect(gridStepMeters(1)).toBeCloseTo(0.001, 9);
    expect(gridStepMeters(10)).toBeCloseTo(0.01, 9);
  });

  it("rests the grid on the measured part, not the assumed size", () => {
    expect(resolveGridFloor([0.04, 0.05], 0.06)).toBe(0.04);
    expect(resolveGridFloor([null, 0.05], 0.06)).toBe(0.05);
    expect(resolveGridFloor([undefined, undefined], 0.06)).toBe(0.06);
  });

  it("places the grid plane just under the resting face", () => {
    // Regression: the classroom demo preview had no grid at all, while the
    // Studio and revolved-geometry views did. Every 3D visor now shares this
    // offset: measured half-height plus a small lift against z-fighting.
    expect(gridPlaneDistance([0.1], 0.5, 0.01, 0.4)).toBeCloseTo(0.102, 9);
    expect(gridPlaneDistance([null], 0.5, 0.01, 0.4)).toBeCloseTo(0.502, 9);
    expect(gridPlaneDistance([0.04], 0.5, 0.1, 0.1)).toBeCloseTo(0.055, 9);
  });

  it("skips non-positive or non-finite measurements", () => {
    expect(resolveGridFloor([0, -0.01, NaN, Infinity, 0.05], 0.06)).toBe(0.05);
    expect(resolveGridFloor([0, null], 0.06)).toBe(0.06);
  });
});
