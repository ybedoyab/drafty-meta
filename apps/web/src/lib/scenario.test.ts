import { describe, expect, it } from "vitest";
import {
  fieldLabel,
  formFields,
  formFromInputs,
  groupFields,
  inputsFromForm,
  messageSegments,
  recallScenarioId,
  forgetScenarioId,
  rememberScenarioId,
  scenarioFields,
  type PartCatalogView,
  type PartInput,
  type PartSummary,
  type ScenarioInputs,
} from "./scenario";

const field = (name: string, label: string, extra: Partial<PartInput> = {}): PartInput => ({
  name,
  label,
  unit: "m",
  display_unit: "m",
  display_scale: 1,
  kind: "number",
  group: "Geometry",
  required: true,
  choices: [],
  ...extra,
});

const ibeam: PartSummary = {
  id: "simply_supported_ibeam",
  name: "simply supported classroom I-beam",
  description: "",
  domain: "structural",
  analysis: ["analytical", "beam-element"],
  exports: ["JSON report"],
  where: "scenario",
  methods: [],
  limits: [],
  inputs: [
    field("span_m", "Span"),
    field("depth_m", "Depth", { display_unit: "mm", display_scale: 1000 }),
    field("jurisdiction", "Jurisdiction", { kind: "text", unit: "", display_unit: "", group: "Materials and loads" }),
    field("tributary_width_m", "Tributary width", { group: "Materials and loads" }),
    field("dead_n_per_m2", "Dead load", { unit: "N/m²", display_unit: "kN/m²", display_scale: 0.001, group: "Materials and loads" }),
    field("beam_self_weight_n_per_m", "Beam self-weight", { unit: "N/m", display_unit: "N/m", group: "Materials and loads" }),
  ],
};

const bracket: PartSummary = {
  ...ibeam,
  id: "l_bracket",
  domain: "mechanical",
  inputs: [
    field("leg_x_m", "Leg along x", { display_unit: "mm", display_scale: 1000 }),
    field("material_id", "Material", { kind: "choice", unit: "", display_unit: "", choices: ["steel_s235"] }),
    field("support_face", "Fixed face", { kind: "face", unit: "", display_unit: "", choices: ["xmin"] }),
  ],
};

describe("scenario inputs", () => {
  it("converts the registry form to SI and leaves a blank width unknown", () => {
    const fields = formFields(ibeam);
    const inputs = inputsFromForm(
      { jurisdiction: " Colombia ", span_m: "6", tributary_width_m: "", dead_n_per_m2: "3", depth_m: "200", beam_self_weight_n_per_m: "0.4" },
      fields,
    );
    expect(inputs.tributary_width_m).toBeNull();
    expect(inputs.dead_n_per_m2).toBe(3000);
    expect(inputs.depth_m).toBeCloseTo(0.2);
    expect(inputs.beam_self_weight_n_per_m).toBeCloseTo(0.4);
    expect(inputs.jurisdiction).toBe("Colombia");
    const form = formFromInputs(inputs as unknown as ScenarioInputs, fields);
    expect(form.dead_n_per_m2).toBe("3");
    expect(form.depth_m).toBe("200");
  });

  it("shows stored metres without floating-point noise", () => {
    const form = formFromInputs({ leg_x_m: 0.07 } as unknown as ScenarioInputs, formFields(bracket));
    expect(form.leg_x_m).toBe("70");
  });

  it("labels fields with display units and keeps faces out of the form", () => {
    expect(formFields(ibeam).map(fieldLabel)).toContain("Dead load kN/m²");
    expect(formFields(bracket).map((item) => item.name)).toEqual(["leg_x_m", "material_id"]);
    expect(groupFields(formFields(ibeam)).map(([group]) => group)).toEqual(["Geometry", "Materials and loads"]);
  });

  it("collects editable fields from every chat part, not Studio parts", () => {
    const studio: PartSummary = { ...ibeam, id: "plate", where: "studio", inputs: [field("plate.length_m", "Length")] };
    const catalog: PartCatalogView = {
      status: "unclassified",
      requested_part: null,
      active_part: null,
      form_part: ibeam,
      parts: [ibeam, bracket, studio],
      message: "",
    };
    const names = scenarioFields(catalog).map((item) => item.name);
    expect(names).toContain("leg_x_m");
    expect(names).toContain("span_m");
    expect(names).not.toContain("plate.length_m");
    expect(names).not.toContain("support_face");
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
    forgetScenarioId(memory, "22222222-2222-4222-8222-222222222222");
    expect(recallScenarioId(memory)).toBe("11111111-1111-4111-8111-111111111111");
    forgetScenarioId(memory, "11111111-1111-4111-8111-111111111111");
    expect(recallScenarioId(memory)).toBeNull();
  });
});

describe("reply links", () => {
  it("links the capabilities path only where the server put it in parentheses", () => {
    expect(messageSegments("Drafty can't model a coffee mug yet. The Capabilities page (/capabilities) lists it.")).toEqual([
      { text: "Drafty can't model a coffee mug yet. The Capabilities page ", link: false },
      { text: "/capabilities", link: true },
      { text: " lists it.", link: false },
    ]);
    expect(messageSegments("See https://example.com/capabilities for more.")).toEqual([
      { text: "See https://example.com/capabilities for more.", link: false },
    ]);
  });
});
