import { describe, expect, it } from "vitest";
import { benchmarkForm, formToSpec, mmFromMeters, mpaFromPascals, specToForm } from "./design";

describe("design units", () => {
  it("converts the cantilever benchmark into SI", () => {
    const spec = formToSpec(benchmarkForm);
    expect(spec.beam).toEqual({ length_m: 0.3, width_m: 0.02, height_m: 0.012 });
    expect(spec.mesh_size_m).toBeCloseTo(0.006);
    expect(spec.loads[0].magnitude).toBe(100);
    expect(spec.loads[0].direction.z).toBeCloseTo(-1);
    expect(spec.plate).toBeNull();
  });

  it("converts pressure from MPa to pascals", () => {
    const spec = formToSpec({
      ...benchmarkForm,
      kind: "plate",
      loadMode: "pressure",
      loadSurface: "zmax",
      magnitude: 0.01,
      thicknessMm: 8,
    });
    expect(spec.loads[0].magnitude).toBeCloseTo(10_000);
    expect(spec.plate?.thickness_m).toBeCloseTo(0.008);
  });

  it("round-trips a proposed specification back into the form", () => {
    const spec = formToSpec(benchmarkForm);
    const form = specToForm(spec, benchmarkForm);
    expect(form.lengthMm).toBeCloseTo(300);
    expect(form.heightMm).toBeCloseTo(12);
    expect(form.magnitude).toBeCloseTo(100);
  });

  it("displays millimeters and megapascals", () => {
    expect(mmFromMeters(0.012)).toBeCloseTo(12);
    expect(mpaFromPascals(31.25e6)).toBeCloseTo(31.25);
  });
});
