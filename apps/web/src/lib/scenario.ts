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
}

export interface ScenarioForm {
  jurisdiction: string;
  spanM: string;
  tributaryM: string;
  deadKn: string;
  liveKn: string;
  selfWeight: string;
  depthMm: string;
  flangeWidthMm: string;
  flangeThicknessMm: string;
  webThicknessMm: string;
  supports: string;
}

export const emptyForm = (): ScenarioForm => ({
  jurisdiction: "",
  spanM: "",
  tributaryM: "",
  deadKn: "",
  liveKn: "",
  selfWeight: "",
  depthMm: "",
  flangeWidthMm: "",
  flangeThicknessMm: "",
  webThicknessMm: "",
  supports: "",
});

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

export function recallScenarioId(storage: Storage): string | null {
  try {
    const parsed = JSON.parse(storage.getItem(KEY) || "") as { version?: number; id?: string };
    return parsed.version === 2 && parsed.id ? parsed.id : null;
  } catch {
    return null;
  }
}

function scaled(value: string, factor: number): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed * factor : null;
}

function shown(value: number | null, factor: number): string {
  return value == null ? "" : String(value * factor);
}

export function inputsFromForm(form: ScenarioForm): ScenarioInputs {
  return {
    jurisdiction: form.jurisdiction.trim(),
    span_m: scaled(form.spanM, 1),
    tributary_width_m: scaled(form.tributaryM, 1),
    dead_n_per_m2: scaled(form.deadKn, 1000),
    live_n_per_m2: scaled(form.liveKn, 1000),
    beam_self_weight_n_per_m: scaled(form.selfWeight, 1),
    depth_m: scaled(form.depthMm, 0.001),
    flange_width_m: scaled(form.flangeWidthMm, 0.001),
    flange_thickness_m: scaled(form.flangeThicknessMm, 0.001),
    web_thickness_m: scaled(form.webThicknessMm, 0.001),
    student_count: null,
    supports: form.supports.trim(),
  };
}

export function formFromInputs(inputs: ScenarioInputs): ScenarioForm {
  return {
    jurisdiction: inputs.jurisdiction || "",
    spanM: shown(inputs.span_m, 1),
    tributaryM: shown(inputs.tributary_width_m, 1),
    deadKn: shown(inputs.dead_n_per_m2, 0.001),
    liveKn: shown(inputs.live_n_per_m2, 0.001),
    selfWeight: shown(inputs.beam_self_weight_n_per_m, 1),
    depthMm: shown(inputs.depth_m, 1000),
    flangeWidthMm: shown(inputs.flange_width_m, 1000),
    flangeThicknessMm: shown(inputs.flange_thickness_m, 1000),
    webThicknessMm: shown(inputs.web_thickness_m, 1000),
    supports: inputs.supports || "",
  };
}
