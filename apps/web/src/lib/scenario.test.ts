import { describe, expect, it } from "vitest";
import { formFromInputs, inputsFromForm, recallScenarioId, rememberScenarioId, type ScenarioForm } from "./scenario";

describe("scenario inputs", () => {
  it("converts the form to SI and leaves a blank width unknown", () => {
    const form: ScenarioForm = {
      jurisdiction: "Colombia",
      spanM: "6",
      tributaryM: "",
      deadKn: "3",
      liveKn: "",
      selfWeight: "0.4",
      depthMm: "200",
      flangeWidthMm: "100",
      flangeThicknessMm: "10",
      webThicknessMm: "6",
      supports: "simply supported",
    };
    const inputs = inputsFromForm(form);
    expect(inputs.tributary_width_m).toBeNull();
    expect(inputs.dead_n_per_m2).toBe(3000);
    expect(inputs.depth_m).toBeCloseTo(0.2);
    expect(inputs.beam_self_weight_n_per_m).toBeCloseTo(0.4);
    expect(formFromInputs(inputs).deadKn).toBe("3");
    expect(formFromInputs(inputs).depthMm).toBe("200");
  });

  it("remembers only a versioned scenario id", () => {
    const storage = new Map<string, string>();
    const memory = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    } as unknown as Storage;
    expect(recallScenarioId(memory)).toBeNull();
    rememberScenarioId(memory, "11111111-1111-4111-8111-111111111111");
    expect(recallScenarioId(memory)).toBe("11111111-1111-4111-8111-111111111111");
  });
});
