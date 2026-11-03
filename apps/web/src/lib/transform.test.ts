import { describe, expect, it } from "vitest";
import { benchmarkForm } from "./design";
import { axisSizesMm, hasVisualEdits, quarterMatrix, rotateForm, scaleForm } from "./transform";

describe("visual scale write-back", () => {
  it("scales a beam per axis into its dimension fields", () => {
    const scaled = scaleForm(benchmarkForm, [1.5, 2, 0.5]);
    expect([scaled.lengthMm, scaled.widthMm, scaled.heightMm]).toEqual([450, 40, 6]);
    expect(scaled.magnitude).toBe(benchmarkForm.magnitude);
  });

  it("scales plate thickness on Z and bracket legs on X and Z", () => {
    const plate = scaleForm({ ...benchmarkForm, kind: "plate", thicknessMm: 8 }, [1, 1, 2]);
    expect(plate.thicknessMm).toBe(16);
    const bracket = scaleForm({ ...benchmarkForm, kind: "l_bracket" }, [2, 1, 1.5]);
    expect([bracket.legXMm, bracket.legZMm, bracket.thicknessMm]).toEqual([160, 120, benchmarkForm.thicknessMm]);
  });

  it("snaps scaled dimensions to the grid step and ignores bad factors", () => {
    expect(scaleForm(benchmarkForm, [1.13, 1, 1], 10).lengthMm).toBe(340);
    expect(scaleForm(benchmarkForm, [0, Number.NaN, -1]).lengthMm).toBe(benchmarkForm.lengthMm);
  });
});

describe("quarter-turn rotation remap", () => {
  it("rotating a beam about Z swaps length and width and remaps faces", () => {
    const rotated = rotateForm(benchmarkForm, quarterMatrix("z", 1));
    expect(rotated).not.toBeNull();
    expect([rotated!.lengthMm, rotated!.widthMm, rotated!.heightMm]).toEqual([20, 300, 12]);
    expect(rotated!.support).toBe("ymin");
    expect(rotated!.loadSurface).toBe("ymax");
    expect([rotated!.directionX, rotated!.directionY, rotated!.directionZ]).toEqual([0, 0, -1]);
  });

  it("rotating a beam about X swaps width and height and rotates the load direction", () => {
    const form = { ...benchmarkForm, directionX: 0, directionY: 1, directionZ: 0 };
    const rotated = rotateForm(form, quarterMatrix("x", 1));
    expect([rotated!.widthMm, rotated!.heightMm]).toEqual([12, 20]);
    expect([rotated!.directionX, rotated!.directionY, rotated!.directionZ]).toEqual([0, 0, 1]);
  });

  it("swaps the hole grid when a perforated plate turns about Z", () => {
    const form = { ...benchmarkForm, kind: "perforated_plate" as const, holeCountX: 3, holeCountY: 1 };
    const rotated = rotateForm(form, quarterMatrix("z", 1));
    expect([rotated!.holeCountX, rotated!.holeCountY]).toEqual([1, 3]);
  });

  it("refuses rotations the spec cannot represent", () => {
    const perforated = { ...benchmarkForm, kind: "perforated_plate" as const };
    expect(rotateForm(perforated, quarterMatrix("x", 1))).toBeNull();
    expect(rotateForm(perforated, quarterMatrix("x", 2))).not.toBeNull();
    expect(rotateForm({ ...benchmarkForm, kind: "l_bracket" }, quarterMatrix("z", 1))).toBeNull();
    expect(rotateForm(benchmarkForm, quarterMatrix("z", 4))).toBe(benchmarkForm);
  });

  it("counts a 180-degree flip as an edit even when dimensions stay the same", () => {
    const flipped = rotateForm(benchmarkForm, quarterMatrix("x", 2));
    expect(flipped).not.toBeNull();
    expect(axisSizesMm(flipped!)).toEqual(axisSizesMm(benchmarkForm));
    expect(hasVisualEdits(flipped!, benchmarkForm)).toBe(true);
    expect(hasVisualEdits(benchmarkForm, benchmarkForm)).toBe(false);
    expect(hasVisualEdits({ ...benchmarkForm, magnitude: 250 }, benchmarkForm)).toBe(false);
    expect(hasVisualEdits(scaleForm(benchmarkForm, [1.5, 1, 1]), benchmarkForm)).toBe(true);
  });

  it("reports axis sizes per kind", () => {
    expect(axisSizesMm(benchmarkForm)).toEqual([300, 20, 12]);
    expect(axisSizesMm({ ...benchmarkForm, kind: "plate", thicknessMm: 8 })).toEqual([300, 20, 8]);
  });
});
