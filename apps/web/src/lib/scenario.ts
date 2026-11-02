export interface ScenarioInputs {
  jurisdiction: string;
  span_m: number | null;
  tributary_width_m: number | null;
  dead_n_per_m2: number | null;
  live_n_per_m2: number | null;
  beam_self_weight_n_per_m: number | null;
  depth_m: number | null;
  flange_width_m: number | null;
  flange_thickness_m: number | null;
  web_thickness_m: number | null;
  student_count: number | null;
  supports: string;
  force_n?: number | null;
  displacement_limit_m?: number | null;
  leg_x_m?: number | null;
  leg_z_m?: number | null;
  bracket_width_m?: number | null;
  bracket_thickness_m?: number | null;
  material_id?: string;
  support_face?: string;
  load_face?: string;
  domain?: string;
  physical_system?: string;
  requested_part?: string;
}

/** One registry input. Stored in SI; shown as stored value * display_scale. */
export interface PartInput {
  name: string;
  label: string;
  unit: string;
  display_unit: string;
  display_scale: number;
  kind: "number" | "text" | "choice" | "face";
  group: string;
  required: boolean;
  choices: string[];
}

export interface PartSummary {
  id: string;
  name: string;
  description: string;
  domain: string;
  analysis: string[];
  exports: string[];
  where: "scenario" | "studio";
  inputs: PartInput[];
}

export interface PartCatalogView {
  status: "supported" | "unsupported" | "unclassified";
  requested_part: string | null;
  active_part: PartSummary | null;
  form_part: PartSummary | null;
  parts: PartSummary[];
  message: string;
}

/** Form text keyed by registry input name, in display units. */
export type ScenarioForm = Record<string, string>;

export const emptyForm = (): ScenarioForm => ({});

export function fieldLabel(field: PartInput): string {
  return field.display_unit ? `${field.label} ${field.display_unit}` : field.label;
}

/** Inputs the Inputs panel edits. Faces are confirmed in the simulation gate instead. */
export function formFields(part: PartSummary | null | undefined): PartInput[] {
  return (part?.inputs ?? []).filter((field) => field.kind !== "face");
}

/** Every editable input of every chat part, so switching parts keeps what was typed. */
export function scenarioFields(catalog: PartCatalogView | null | undefined): PartInput[] {
  const seen = new Map<string, PartInput>();
  for (const part of catalog?.parts ?? []) {
    if (part.where !== "scenario") continue;
    for (const field of formFields(part)) if (!seen.has(field.name)) seen.set(field.name, field);
  }
  return [...seen.values()];
}

export function groupFields(fields: PartInput[]): [string, PartInput[]][] {
  const groups = new Map<string, PartInput[]>();
  for (const field of fields) groups.set(field.group, [...(groups.get(field.group) ?? []), field]);
  return [...groups.entries()];
}

export const CLASSROOM_PROMPT =
  "I need a steel I-beam supporting a classroom floor for approximately 30 students. Research the applicable loads, ask me for the missing dimensions, propose a preliminary structural model, and explain the checks required.";

const KEY = "drafty.scenario.v2";
const STUDIO_KEY = "drafty.studio.pending";

export function stageStudioSpec(storage: Storage, spec: unknown) {
  storage.setItem(STUDIO_KEY, JSON.stringify(spec));
}

export function takeStudioSpec(storage: Storage): unknown | null {
  const raw = storage.getItem(STUDIO_KEY);
  if (!raw) return null;
  storage.removeItem(STUDIO_KEY);
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function rememberScenarioId(storage: Storage, id: string) {
  storage.setItem(KEY, JSON.stringify({ version: 2, id }));
}

export function forgetScenarioId(storage: Storage, id?: string) {
  if (id !== undefined && recallScenarioId(storage) !== id) return;
  storage.removeItem(KEY);
}

export function recallScenarioId(storage: Storage): string | null {
  try {
    const parsed = JSON.parse(storage.getItem(KEY) || "") as { version?: number; id?: string };
    return parsed.version === 2 && parsed.id ? parsed.id : null;
  } catch {
    return null;
  }
}

function parsed(value: string, scale: number): number | null {
  if (value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number / scale : null;
}

function shown(value: unknown, scale: number): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return String(Number((value * scale).toPrecision(12)));
}

/** SI inputs for the listed fields only. Other stored inputs stay as the server has them. */
export function inputsFromForm(form: ScenarioForm, fields: PartInput[]): Record<string, number | string | null> {
  const inputs: Record<string, number | string | null> = {};
  for (const field of fields) {
    const value = form[field.name] ?? "";
    inputs[field.name] = field.kind === "number" ? parsed(value, field.display_scale || 1) : value.trim();
  }
  return inputs;
}

export function formFromInputs(inputs: ScenarioInputs, fields: PartInput[]): ScenarioForm {
  const stored = inputs as unknown as Record<string, unknown>;
  const form: ScenarioForm = {};
  for (const field of fields) {
    const value = stored[field.name];
    form[field.name] = field.kind === "number" ? shown(value, field.display_scale || 1) : String(value ?? "");
  }
  return form;
}
