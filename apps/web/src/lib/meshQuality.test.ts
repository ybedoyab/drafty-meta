import { describe, expect, it } from "vitest";
import { gateLabel, summarizeMeshQuality } from "./meshQuality";

describe("summarizeMeshQuality", () => {
  it("presents Batch 10A fields without inventing certification", () => {
    const view = summarizeMeshQuality(
      {
        element_type: "C3D10",
        elements_checked: 18980,
        jacobian_validation_method: "numpy_tet10_analytical_derivatives+selective_adaptive",
        jacobian_validation_status: "sampled_ok_certification_inconclusive",
        min_jacobian: 3.74e-9,
        max_jacobian: 4.0e-8,
        normalized_jacobian_ratio_min: 0.999,
        inverted_elements: 0,
        degenerate_elements: 0,
        inconclusive_elements: 18980,
        quality_warnings: ["soft ratio warning"],
        certification_note: "certified_valid is never claimed by the NumPy path",
      },
      { element_type: "C3D10", elements: 18980 },
    );
    expect(view.available).toBe(true);
    expect(view.legacyOnly).toBe(false);
    expect(view.wholeElementLabel).toBe("inconclusive");
    expect(view.status).toContain("inconclusive");
    expect(view.inverted).toBe("0");
    expect(view.softWarnings).toEqual(["soft ratio warning"]);
  });

  it("supports historical jobs that only have a legacy jacobian string", () => {
    const view = summarizeMeshQuality(
      {
        elements: 18980,
        inverted_elements: 0,
        jacobian: "positive corner-tetrahedron volume; quadratic mid-edge nodes are matched separately",
      },
      { element_type: "C3D10", elements: 18980 },
    );
    expect(view.available).toBe(true);
    expect(view.legacyOnly).toBe(true);
    expect(view.method).toContain("legacy");
    expect(view.wholeElementLabel).toBe("unavailable");
    expect(view.minJacobian).toBe("—");
  });

  it("marks missing quality as unavailable when no mesh context exists", () => {
    const view = summarizeMeshQuality(undefined, undefined);
    expect(view.available).toBe(false);
    expect(view.status).toBe("unavailable");
  });

  it("falls back to mesh element counts for jobs without quality payload", () => {
    const view = summarizeMeshQuality(undefined, { element_type: "C3D10", elements: 10 });
    expect(view.available).toBe(true);
    expect(view.legacyOnly).toBe(true);
    expect(view.elementType).toBe("C3D10");
    expect(view.elementCount).toBe("10");
  });
});

describe("gateLabel", () => {
  it("formats booleans and strings", () => {
    expect(gateLabel(true)).toBe("passed");
    expect(gateLabel(false)).toBe("failed");
    expect(gateLabel("passed_sampled")).toBe("passed_sampled");
    expect(gateLabel(null)).toBe("—");
  });
});
