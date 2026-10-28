import { describe, expect, it } from "vitest";
import { classroomLineLoad } from "./scenario";

describe("classroom line load", () => {
  it("uses 2.0 kN/m2 once and adds self-weight on the line", () => {
    const result = classroomLineLoad(3000, 2.5, 400);
    expect(result.qLineNPerM).toBeCloseTo((3000 + 2000) * 2.5 + 400);
    expect(result.liveStatus).toBe("assumed");
  });

  it("refuses to invent a width from a headcount", () => {
    expect(() => classroomLineLoad(3000, null)).toThrow(/Tributary width/);
  });
});
