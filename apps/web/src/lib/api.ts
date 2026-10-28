import { z } from "zod";
import type { DesignSpec } from "./design";

const apiBase = import.meta.env.VITE_API_URL ?? "";

export const jobSchema = z.object({
  id: z.string(),
  kind: z.string(),
  status: z.enum([
    "queued",
    "geometry",
    "meshing",
    "solving",
    "postprocessing",
    "completed",
    "failed",
    "cancelled",
  ]),
  message: z.string().nullable(),
  error: z.string().nullable(),
  summary: z
    .object({
      mass_kg: z.number().nullable().optional(),
      max_displacement_m: z.number().nullable().optional(),
      safety_factor: z.number().nullable().optional(),
      validation_status: z.string().nullable().optional(),
      governing_von_mises_pa: z.number().nullable().optional(),
      iterations: z.number().nullable().optional(),
    })
    .nullable(),
  spec: z.unknown().nullable(),
  scenario_id: z.string().nullable().optional(),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
  active: z.boolean(),
});

export type Job = z.infer<typeof jobSchema>;

export interface Health {
  service: string;
  solver: { available: boolean; mode: string; detail: string };
  meta: boolean;
  modal: boolean;
  supabase: boolean;
  auth: string;
  compute: string;
}

export interface SurfaceResult {
  vertices_m: [number, number, number][];
  faces: [number, number, number][];
  displacement_m: [number, number, number][];
  von_mises_pa: number[];
}

export interface SimulationResult {
  units: Record<string, string>;
  validation_status: string;
  solver: { name: string; version: string; mode: string };
  mesh: { nodes: number; elements: number; element_type: string; target_size_m: number };
  mass_kg: number;
  max_displacement_m: number;
  max_von_mises_pa: number;
  governing_von_mises_pa: number;
  safety_factor: number;
  benchmark: {
    applicable: boolean;
    passed: boolean | null;
    analytical_tip_deflection_m?: number;
    fem_tip_deflection_m?: number;
    deflection_error?: number;
    analytical_midspan_stress_pa?: number;
    fem_midspan_stress_pa?: number;
    stress_error?: number;
    notes?: string[];
  };
  equilibrium?: {
    applied_force_n: number[];
    reaction_force_n: number[];
    residual_n: number;
    relative_residual: number;
    passed: boolean;
  };
  stress_assessment?: {
    measure: string;
    exclusion: string;
    exclusion_reason: string;
    safety_factor_status: string;
    nodal_field: string;
    integration_point_field: string;
    displayed_surface: string;
    mesh_sensitivity: string;
  };
  warnings: string[];
  surface: SurfaceResult;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response));
  }
  return response.json() as Promise<T>;
}

async function errorMessage(response: Response) {
  const body = (await response.json().catch(() => null)) as { detail?: unknown } | null;
  if (typeof body?.detail === "string") return body.detail;
  if (Array.isArray(body?.detail)) {
    return body.detail
      .map((item) => (typeof item === "object" && item && "msg" in item ? String(item.msg) : String(item)))
      .join(" ");
  }
  return `${response.status} ${response.statusText}`;
}

export const getHealth = () => api<Health>("/api/v1/health");

export const getJobs = async () => {
  const body = await api<{ jobs: unknown[] }>("/api/v1/jobs");
  return body.jobs.map((job) => jobSchema.parse(job));
};

export const getJob = async (id: string) => jobSchema.parse(await api(`/api/v1/jobs/${id}`));

export const createJob = (
  kind: "simulation" | "optimization",
  spec: DesignSpec,
  optimization?: object,
  scenarioId?: string | null,
) =>
  api<Job>("/api/v1/jobs", {
    method: "POST",
    body: JSON.stringify({ kind, spec, optimization: optimization ?? null, scenario_id: scenarioId ?? null }),
  }).then((job) => jobSchema.parse(job));

export const cancelJob = (id: string) =>
  api<Job>(`/api/v1/jobs/${id}/cancel`, { method: "POST" }).then((job) => jobSchema.parse(job));

export const getResults = (id: string) => api<SimulationResult>(`/api/v1/jobs/${id}/results`);

export const getMaterials = () =>
  api<
    {
      id: string;
      name: string;
      youngs_modulus_pa: number;
      poisson_ratio: number;
      density_kg_m3: number;
      yield_strength_pa: number;
      source: string;
      caveat: string;
    }[]
  >("/api/v1/materials");

export const getOptimization = (id: string) =>
  api<{
    best: {
      mass_kg?: number;
      displacement_m?: number;
      safety_factor?: number;
      thickness_m?: number;
      governing_von_mises_pa?: number;
    } | null;
    submitted: {
      mass_kg?: number;
      displacement_m?: number;
      safety_factor?: number;
      thickness_m?: number;
      governing_von_mises_pa?: number;
    } | null;
    optimality?: string;
    message?: string;
    iterations: { index: number; accepted: boolean; feasible: boolean; error?: string; thickness_m: number }[];
  }>(`/api/v1/jobs/${id}/optimization`);

export const getLog = (id: string) => api<{ solver: string; worker: string }>(`/api/v1/jobs/${id}/log`);

export async function previewSpec(spec: DesignSpec) {
  const response = await fetch(`${apiBase}/api/v1/designs/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(spec),
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  return URL.createObjectURL(await response.blob());
}

export const interpret = (message: string, referenceImageId?: string) =>
  api<{ action: string; message: string; spec: DesignSpec | null; missing_fields?: string[] }>(
    "/api/v1/ai/interpret",
    {
      method: "POST",
      body: JSON.stringify({ message, reference_image_id: referenceImageId ?? null }),
    },
  );

export async function uploadReference(file: File) {
  const body = new FormData();
  body.append("file", file);
  return api<{ id: string; message: string }>("/api/v1/uploads/reference", { method: "POST", body });
}

export function artifactUrl(jobId: string, name: string) {
  return `${apiBase}/api/v1/jobs/${jobId}/artifacts/${name}`;
}

export interface ScenarioSession {
  id: string;
  messages: { role: "user" | "assistant"; text: string }[];
  inputs: import("./scenario").ScenarioInputs;
  evidence: {
    id: string;
    name: string;
    media_type: string;
    role: string;
    note: string;
    byte_length: number;
    sha256: string;
  }[];
  missing: string[];
  errors: string[];
  assumptions: { name: string; statement: string; status: string; provenance: string; source?: string }[];
  sources: { title: string; url?: string; status: string; limit?: string; origin?: string; span?: string; evidence_class?: string; retrieved_at?: string | null }[];
  calculation: { q_line_n_per_m: number; live_n_per_m2: number; trace?: { formula?: string } } | null;
  section: { area_m2: number; inertia_x_m4: number; inertia_y_m4: number } | null;
  beam: { max_moment_n_m: number; end_shear_n: number; midspan_deflection_m: number; material?: { name: string; source: string } } | null;
  model_proposal: { family: string; ready_for_3d_simulation: boolean; ready_for_beam_elements?: boolean; reason: string };
  verification: string[];
  model_questions: string[];
  observations: string[];
  mode: string;
  model: string | null;
  phase?: string;
  analysis: BeamAnalysis | null;
  comparison: BeamAnalysis | null;
  workflow?: string;
  engineering?: {
    domain: string;
    physical_system: string;
    missing: string[];
    suitable_methods: string[];
    unsupported: string[];
    validation_status: string;
    simulator: string;
    quantities: { name: string; value_si: number | null; unit: string; status: string; source: string }[];
  };
  tool_trace?: { tool: string; status: string; detail: string; authorization?: string; output?: Record<string, unknown> }[];
  jobs?: { id: string; kind: string }[];
  studio_spec?: Record<string, unknown> | null;
  studio_approval?: string;
  session_usage?: { input_tokens: number; output_tokens: number; requests: number };
  segmentation?: {
    prompt: string;
    evidence_id: string;
    width?: number | null;
    height?: number | null;
    objects: { object_id: string; left: number; top: number; right: number; bottom: number; path: string }[];
    limit: string;
  };
  ai: string;
}

export interface BeamStation {
  x_m: number;
  shear_n: number;
  moment_n_m: number;
  deflection_m: number;
}

export interface BeamAnalysis {
  method: string;
  status: string;
  passed: boolean;
  stale?: boolean;
  elements: number;
  span_m: number;
  solver: { name: string; formulation: string };
  mesh: { elements: number; nodes: number; element_type: string; free_degrees_of_freedom: number };
  left_reaction_n: number;
  right_reaction_n: number;
  max_shear_n: number;
  max_moment_n_m: number;
  midspan_deflection_m: number;
  max_elastic_bending_stress_pa: number;
  elastic_range: string;
  analytical_midspan_deflection_m: number;
  deflection_error: number;
  moment_error: number;
  equilibrium: { applied_n: number; residual_n: number; residual_relative: number };
  stations: BeamStation[];
  assumptions: string[];
  limitations: string[];
  material?: { name: string; source: string };
  inputs?: { span_m: number | null };
}

export const createScenario = () => api<ScenarioSession>("/api/v1/scenarios", { method: "POST" });

export const getScenario = (id: string) => api<ScenarioSession>(`/api/v1/scenarios/${id}`);

export const turnScenario = (id: string, body: object, signal?: AbortSignal) =>
  api<ScenarioSession>(`/api/v1/scenarios/${id}/turn`, { method: "POST", body: JSON.stringify(body), signal });

export const analyzeScenario = (id: string, body: object) =>
  api<ScenarioSession>(`/api/v1/scenarios/${id}/analyze`, { method: "POST", body: JSON.stringify(body) });

export const dismissScenario = (id: string) =>
  api<ScenarioSession>(`/api/v1/scenarios/${id}/dismiss`, { method: "POST" });

export const approveScenario = (id: string) =>
  api<ScenarioSession>(`/api/v1/scenarios/${id}/approve`, { method: "POST" });

export const confirmScenarioFaces = (id: string, supportFace: string, loadFace: string) =>
  api<ScenarioSession>(`/api/v1/scenarios/${id}/faces`, {
    method: "POST",
    body: JSON.stringify({ support_face: supportFace, load_face: loadFace }),
  });

export const rejectScenario = (id: string) =>
  api<ScenarioSession>(`/api/v1/scenarios/${id}/reject`, { method: "POST" });

export const segmentScenario = (id: string, evidenceId: string, prompt: string) =>
  api<ScenarioSession>(`/api/v1/scenarios/${id}/segment`, {
    method: "POST",
    body: JSON.stringify({ evidence_id: evidenceId, prompt }),
  });

export async function downloadScenarioReport(id: string) {
  const report = await api<unknown>(`/api/v1/scenarios/${id}/report`);
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `drafty-beam-${id}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function uploadScenarioEvidence(id: string, file: File, role: string, note: string) {
  const body = new FormData();
  body.append("file", file);
  body.append("role", role);
  body.append("note", note);
  return api<ScenarioSession>(`/api/v1/scenarios/${id}/evidence`, { method: "POST", body });
}

export const deleteScenarioEvidence = (id: string, evidenceId: string) =>
  api<ScenarioSession>(`/api/v1/scenarios/${id}/evidence/${evidenceId}`, { method: "DELETE" });

export function scenarioEvidenceUrl(scenarioId: string, evidenceId: string) {
  return `${apiBase}/api/v1/scenarios/${scenarioId}/evidence/${evidenceId}`;
}
