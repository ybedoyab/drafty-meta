import { describe, expect, it } from "vitest";
import { faceCentroid, loadDirection } from "./markers";

const box: [number, number, number][] = [
  [0, 0, 0],
  [0.3, 0, 0],
  [0, 0.02, 0],
  [0, 0, 0.012],
  [0.3, 0.02, 0.012],
];

describe("support and load markers", () => {
  it("anchors the support at the selected bounding-box face", () => {
    expect(faceCentroid(box, "xmin")[0]).toBeCloseTo(0);
    expect(faceCentroid(box, "xmax")[0]).toBeCloseTo(0.3);
    expect(faceCentroid(box, "zmin")[2]).toBeCloseTo(0);
  });

  it("keeps the arrow on the physical force axis", () => {
    expect(loadDirection([0, 0, -100]).axisLabel).toBe("−Z");
    expect(loadDirection([0, 0, 100]).axisLabel).toBe("+Z");
    expect(loadDirection([4, 1, 0]).axisLabel).toBe("+X");
    expect(loadDirection([0, -2, 0.2]).axisLabel).toBe("−Y");
    expect(loadDirection([0, 0, -1]).unit[2]).toBeCloseTo(-1);
  });
});
