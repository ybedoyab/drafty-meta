import { describe, expect, it } from "vitest";
import { benchmarkForm, formToSpec, specToForm } from "./design";
import {
  clampOffsets,
  classifySketch,
  closeSketchWithAspect,
  draftPlacementM,
  proposeSketchSize,
  type SketchAdditionForm,
} from "./sketch";

const roofStroke = [
  { x: 100, y: 300 },
  { x: 320, y: 300 },
  { x: 210, y: 120 },
  { x: 104, y: 296 },
];

const roof: SketchAdditionForm = {
  id: "sketch-1",
  label: "Roof",
  face: "zmax",
  profile: [
    { u: 0, v: 0 },
    { u: 1, v: 0 },
    { u: 0.5, v: 1 },
  ],
  widthMm: 200,
  heightMm: 50,
  depthMm: 12,
  offsetUMm: 0,
  offsetWMm: 0,
};

describe("sketch closing and proposal", () => {
  it("closes a freehand stroke into a normalized profile with its aspect", () => {
    const closed = closeSketchWithAspect(roofStroke);
    expect(closed).not.toBeNull();
    expect(closed!.aspect).toBeCloseTo(180 / 220);
    const us = closed!.profile.map((point) => point.u);
    const vs = closed!.profile.map((point) => point.v);
    expect(Math.min(...us)).toBe(0);
    expect(Math.max(...us)).toBe(1);
    expect(Math.min(...vs)).toBe(0);
    expect(Math.max(...vs)).toBe(1);
  });

  it("rejects a stroke that is only a dot or a line", () => {
    expect(closeSketchWithAspect([{ x: 1, y: 1 }, { x: 2, y: 2 }])).toBeNull();
    expect(closeSketchWithAspect([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }])).toBeNull();
  });

  it("names a centred triangle a roof and sizes it from the face", () => {
    expect(classifySketch(roof.profile)).toBe("Roof");
    // benchmark beam top face: 300 mm across (X) by 20 mm deep (Y)
    const size = proposeSketchSize(0.5, benchmarkForm, "zmax", false);
    expect(size.widthMm).toBeCloseTo(180);
    expect(size.heightMm).toBeCloseTo(90);
    expect(size.depthMm).toBeCloseTo(12);
  });

  it("proposes a standalone size with no part", () => {
    const size = proposeSketchSize(0.75, null, "zmax", true);
    expect(size).toEqual({ widthMm: 80, heightMm: 60, depthMm: 36 });
  });
});

describe("sketch placement", () => {
  it("places a roof on the beam top, rising in +Z and centred in Y", () => {
    const placement = draftPlacementM(benchmarkForm, roof);
    expect(placement.origin[2]).toBeCloseTo(0.006);
    expect(placement.origin[1]).toBeCloseTo(-0.006);
    expect(placement.vAxis).toEqual([0, 0, 1]);
    expect(placement.depthM).toBeCloseTo(0.012);
  });

  it("clamps drag offsets so the footprint stays inside the face", () => {
    const clamped = clampOffsets(benchmarkForm, { ...roof, offsetUMm: 500, offsetWMm: -500 });
    expect(clamped.offsetUMm).toBeCloseTo((300 - 200) / 2 - 0.1);
    expect(clamped.offsetWMm).toBeCloseTo(-((20 - 12) / 2 - 0.1));
  });

  it("round-trips a sketch addition through the API spec", () => {
    const form = { ...benchmarkForm, additions: [roof] };
    const spec = formToSpec(form);
    expect(spec.additions).toHaveLength(1);
    expect(spec.additions[0]).toMatchObject({ label: "Roof", face: "zmax", width_m: 0.2, height_m: 0.05, depth_m: 0.012 });
    const restored = specToForm(spec, benchmarkForm);
    expect(restored.additions[0]).toMatchObject({ label: "Roof", widthMm: 200, heightMm: 50, depthMm: 12 });
    expect(restored.additions[0].profile).toEqual(roof.profile);
  });

  it("writes a sketch-only part with no base geometry", () => {
    const spec = formToSpec({ ...benchmarkForm, kind: "sketch_prism", additions: [roof] });
    expect(spec.beam).toBeNull();
    expect(spec.plate).toBeNull();
    expect(spec.additions).toHaveLength(1);
  });
});
