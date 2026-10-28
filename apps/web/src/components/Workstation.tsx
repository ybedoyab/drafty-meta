import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import logo from "@/assets/logo.png";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Viewport } from "@/components/Viewport";
import { Button } from "@/components/ui/button";
import {
  artifactUrl,
  cancelJob,
  createJob,
  getHealth,
  getJob,
  getJobs,
  getLog,
  getResults,
  interpret,
  previewSpec,
  uploadReference,
  type Job,
  type SimulationResult,
} from "@/lib/api";
import { turbo } from "@/lib/colormap";
import {
  SURFACES,
  benchmarkForm,
  formToSpec,
  formatEngineering,
  mmFromMeters,
  mpaFromPascals,
  specToForm,
  type DesignForm,
  type PartKind,
} from "@/lib/design";

const STAGES = ["queued", "geometry", "meshing", "solving", "postprocessing", "completed"] as const;
const MATERIALS = [
  ["steel_s235", "S235 steel"],
  ["aluminum_6061_t6", "Aluminum 6061-T6"],
  ["stainless_316", "Stainless 316"],
  ["titanium_ti6al4v", "Ti-6Al-4V"],
  ["abs", "ABS"],
] as const;

export function Workstation() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<DesignForm>(benchmarkForm);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [chat, setChat] = useState<{ role: "you" | "drafty"; text: string }[]>([]);
  const [imageId, setImageId] = useState<string | null>(null);
  const [wireframe, setWireframe] = useState(false);
  const [visualScale, setVisualScale] = useState(1);
  const [lowerMm, setLowerMm] = useState(8);
  const [upperMm, setUpperMm] = useState(16);
  const [minimumFactor, setMinimumFactor] = useState(2);
  const [formError, setFormError] = useState<string | null>(null);
  const [exampleBusy, setExampleBusy] = useState(false);

  const health = useQuery({ queryKey: ["health"], queryFn: getHealth, retry: false, refetchInterval: 15000 });
  const jobs = useQuery({ queryKey: ["jobs"], queryFn: getJobs, refetchInterval: 2000 });
  const job = useQuery({
    queryKey: ["job", activeId],
    queryFn: () => getJob(activeId!),
    enabled: Boolean(activeId),
    refetchInterval: (query) => (query.state.data?.active ? 1000 : false),
  });
  const results = useQuery({
    queryKey: ["results", activeId],
    queryFn: () => getResults(activeId!),
    enabled: job.data?.status === "completed",
  });
  const log = useQuery({
    queryKey: ["log", activeId, job.data?.status],
    queryFn: () => getLog(activeId!),
    enabled: Boolean(activeId) && job.data?.status !== "queued",
  });

  useEffect(() => {
    if (!results.data) return;
    const size = modelExtent(results.data.surface);
    const physical = results.data.max_displacement_m;
    setVisualScale(physical > 0 ? Math.min(80, (0.12 * size) / physical) : 1);
  }, [results.data]);

  const legend = useMemo(() => {
    const values = results.data?.surface.von_mises_pa ?? [];
    if (!values.length) return null;
    let min = values[0];
    let max = values[0];
    for (const value of values) {
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    return { min, max };
  }, [results.data]);

  const preview = useMutation({
    mutationFn: async () => previewSpec(formToSpec(form)),
    onSuccess: (url) => {
      setPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return url;
      });
      setFormError(null);
    },
    onError: (error: Error) => setFormError(error.message),
  });

  const run = useMutation({
    mutationFn: async (kind: "simulation" | "optimization") => {
      const spec = formToSpec(form);
      const optimization =
        kind === "optimization"
          ? {
              lower_m: lowerMm / 1000,
              upper_m: upperMm / 1000,
              min_safety_factor: minimumFactor,
              max_iterations: 4,
            }
          : undefined;
      return createJob(kind, spec, optimization);
    },
    onSuccess: async (created) => {
      setActiveId(created.id);
      setFormError(null);
      await queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (error: Error) => setFormError(error.message),
  });

  async function loadExample() {
    setForm(benchmarkForm);
    setFormError(null);
    setExampleBusy(true);
    try {
      const url = await previewSpec(formToSpec(benchmarkForm));
      setPreviewUrl((currentUrl) => {
        if (currentUrl) URL.revokeObjectURL(currentUrl);
        return url;
      });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "The example preview failed.");
    } finally {
      setExampleBusy(false);
    }
  }

  async function ask() {
    const text = message.trim();
    if (!text) return;
    setChat((current) => [...current, { role: "you", text }]);
    setMessage("");
    try {
      const response = await interpret(text, imageId ?? undefined);
      if (response.spec) {
        setForm((current) => specToForm(response.spec!, current));
      }
      setChat((current) => [
        ...current,
        {
          role: "drafty",
          text: response.spec
            ? `${response.message} The form now holds that specification. Run analysis after you check the numbers.`
            : response.message,
        },
      ]);
    } catch (error) {
      setChat((current) => [...current, { role: "drafty", text: error instanceof Error ? error.message : "Request failed." }]);
    }
  }

  const current = job.data;
  const result = results.data;

  return (
    <div className="grid h-full grid-cols-[360px_minmax(0,1fr)_320px] grid-rows-[64px_minmax(0,1fr)_210px] bg-slate-100 text-gray-900">
      <header className="col-span-3 flex items-center justify-between border-b border-gray-200 bg-white px-5 shadow-sm">
        <div className="flex items-center gap-6">
          <Link to="/">
            <img src={logo} alt="Drafty" className="h-9 w-auto" />
          </Link>
          <nav className="flex items-center gap-1 text-sm font-medium">
            <Link to="/" className="rounded-md px-3 py-1.5 text-gray-600 hover:bg-indigo-50 hover:text-indigo-600">
              Home
            </Link>
            <Link to="/studio" className="rounded-md bg-indigo-50 px-3 py-1.5 text-indigo-700">
              Studio
            </Link>
          </nav>
        </div>
        <p className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-gray-600">
          {health.data
            ? `solver ${health.data.solver.mode} · meta ${health.data.meta ? "on" : "off"}`
            : health.error instanceof Error
              ? health.error.message
              : "connecting"}
        </p>
      </header>

      <aside className="overflow-auto border-r border-gray-200 bg-white p-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-indigo-600">1. Start here</p>
        <button
          type="button"
          onClick={() => void loadExample()}
          disabled={exampleBusy}
          className="mb-4 w-full rounded-2xl border border-indigo-100 bg-gradient-to-br from-white to-indigo-50 p-4 text-left shadow-sm transition hover:border-indigo-300 hover:shadow-md disabled:opacity-60"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">Example</p>
          <p className="mt-1 text-sm font-semibold text-gray-900">
            {exampleBusy ? "Building the example solid…" : "Load cantilever example"}
          </p>
          <p className="mt-1 text-xs leading-5 text-gray-500">
            300 × 20 × 12 mm steel beam, fixed at one end, 100 N downward at the free end. No AI key required.
          </p>
        </button>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-indigo-600">2. Part</p>
        <div className="grid grid-cols-2 gap-2">
          <label className="field col-span-2">
            <span>Name</span>
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </label>
          <label className="field col-span-2">
            <span>Part</span>
            <select
              value={form.kind}
              onChange={(event) => setForm({ ...form, kind: event.target.value as PartKind })}
            >
              <option value="cantilever_beam">Cantilever beam</option>
              <option value="plate">Plate</option>
              <option value="l_bracket">L-bracket</option>
              <option value="perforated_plate">Perforated plate</option>
            </select>
          </label>
          <NumberField label="Length mm" value={form.lengthMm} onChange={(lengthMm) => setForm({ ...form, lengthMm })} />
          <NumberField label="Width mm" value={form.widthMm} onChange={(widthMm) => setForm({ ...form, widthMm })} />
          {form.kind === "cantilever_beam" ? (
            <NumberField label="Height mm" value={form.heightMm} onChange={(heightMm) => setForm({ ...form, heightMm })} />
          ) : (
            <NumberField
              label="Thickness mm"
              value={form.thicknessMm}
              onChange={(thicknessMm) => setForm({ ...form, thicknessMm })}
            />
          )}
          {form.kind === "l_bracket" && (
            <>
              <NumberField label="Leg X mm" value={form.legXMm} onChange={(legXMm) => setForm({ ...form, legXMm })} />
              <NumberField label="Leg Z mm" value={form.legZMm} onChange={(legZMm) => setForm({ ...form, legZMm })} />
            </>
          )}
          {form.kind === "perforated_plate" && (
            <>
              <NumberField
                label="Hole radius mm"
                value={form.holeRadiusMm}
                onChange={(holeRadiusMm) => setForm({ ...form, holeRadiusMm })}
              />
              <NumberField
                label="Margin mm"
                value={form.holeMarginMm}
                onChange={(holeMarginMm) => setForm({ ...form, holeMarginMm })}
              />
              <NumberField
                label="Holes X"
                value={form.holeCountX}
                onChange={(holeCountX) => setForm({ ...form, holeCountX })}
              />
              <NumberField
                label="Holes Y"
                value={form.holeCountY}
                onChange={(holeCountY) => setForm({ ...form, holeCountY })}
              />
            </>
          )}
          <label className="field col-span-2">
            <span>Material</span>
            <select
              value={form.materialId}
              onChange={(event) => setForm({ ...form, materialId: event.target.value })}
            >
              {MATERIALS.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <p className="col-span-2 mt-2 text-xs font-semibold uppercase tracking-wide text-indigo-600">3. Hold and load</p>
          <label className="field">
            <span>Support</span>
            <select
              value={form.support}
              onChange={(event) => setForm({ ...form, support: event.target.value as DesignForm["support"] })}
            >
              {SURFACES.map((surface) => (
                <option key={surface}>{surface}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Load face</span>
            <select
              value={form.loadSurface}
              onChange={(event) =>
                setForm({ ...form, loadSurface: event.target.value as DesignForm["loadSurface"] })
              }
            >
              {SURFACES.map((surface) => (
                <option key={surface}>{surface}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Load</span>
            <select
              value={form.loadMode}
              onChange={(event) =>
                setForm({ ...form, loadMode: event.target.value as DesignForm["loadMode"] })
              }
            >
              <option value="force">Force N</option>
              <option value="pressure">Pressure MPa</option>
            </select>
          </label>
          <NumberField
            label={form.loadMode === "pressure" ? "MPa" : "Newton"}
            value={form.magnitude}
            onChange={(magnitude) => setForm({ ...form, magnitude })}
          />
          <NumberField label="Dir X" value={form.directionX} onChange={(directionX) => setForm({ ...form, directionX })} />
          <NumberField label="Dir Y" value={form.directionY} onChange={(directionY) => setForm({ ...form, directionY })} />
          <NumberField label="Dir Z" value={form.directionZ} onChange={(directionZ) => setForm({ ...form, directionZ })} />
        </div>
        <div className="mt-3 flex gap-2">
          <Button variant="primary" onClick={() => preview.mutate()} disabled={preview.isPending}>
            {preview.isPending ? "Building solid" : "Preview solid"}
          </Button>
        </div>
        <p className="mt-3 text-xs leading-5 text-gray-500">
          Enter exact dimensions. A reference image is stored as context and is not measured.
        </p>
        <label className="field mt-2">
          <span>Reference image</span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              try {
                const uploaded = await uploadReference(file);
                setImageId(uploaded.id);
                setFormError(uploaded.message);
              } catch (error) {
                setFormError(error instanceof Error ? error.message : "Upload failed.");
              }
            }}
          />
        </label>
        <div className="mt-4 border-t border-gray-200 pt-3">
          <label className="field">
            <span>Design chat</span>
            <textarea
              rows={3}
              value={message}
              placeholder="Optional. Needs a Meta API key. The example button works without it."
              onChange={(event) => setMessage(event.target.value)}
            />
          </label>
          <Button className="mt-2" onClick={() => void ask()}>
            Ask Drafty
          </Button>
          <div className="mt-2 max-h-36 space-y-2 overflow-auto text-xs leading-5">
            {chat.map((entry, index) => (
              <p key={`${entry.role}-${index}`}>
                <span className="font-medium text-indigo-600">{entry.role === "you" ? "You" : "Drafty"}: </span>
                {entry.text}
              </p>
            ))}
          </div>
        </div>
      </aside>

      <main className="relative min-h-0 bg-slate-100">
        <Suspense fallback={null}>
          <Viewport
            previewUrl={previewUrl}
            surface={result?.surface ?? null}
            scale={visualScale}
            wireframe={wireframe}
          />
        </Suspense>
        <div className="pointer-events-none absolute left-3 top-3 rounded-lg border border-gray-200 bg-white/90 px-3 py-1 text-xs text-gray-500 shadow-sm">
          {result ? "von Mises on the surface mesh · meters" : "CAD preview · meters"}
        </div>
        {!previewUrl && !result && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="rounded-2xl border border-indigo-100 bg-white px-8 py-6 text-center shadow-lg">
              <p className="text-lg font-semibold text-gray-900">Ready to generate?</p>
              <p className="mt-1 text-sm text-gray-500">Load the example or enter dimensions, then preview the solid.</p>
            </div>
          </div>
        )}
        {legend && (
          <div className="absolute bottom-3 left-3 right-3 rounded-lg border border-gray-200 bg-white/95 p-2 shadow-sm">
            <div
              className="h-2 rounded"
              style={{
                background: `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1]
                  .map((stop) => {
                    const [red, green, blue] = turbo(stop);
                    return `rgb(${red * 255} ${green * 255} ${blue * 255})`;
                  })
                  .join(",")})`,
              }}
            />
            <div className="mt-1 flex justify-between text-[11px] text-gray-500">
              <span>{formatEngineering(mpaFromPascals(legend.min))} MPa</span>
              <span>von Mises</span>
              <span>{formatEngineering(mpaFromPascals(legend.max))} MPa</span>
            </div>
          </div>
        )}
      </main>

      <aside className="overflow-auto border-l border-gray-200 bg-white p-4 text-sm">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-indigo-600">4. Run and read</h2>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <NumberField label="Mesh mm" value={form.meshMm} onChange={(meshMm) => setForm({ ...form, meshMm })} />
          <label className="field">
            <span>Order</span>
            <select
              value={form.elementOrder}
              onChange={(event) =>
                setForm({ ...form, elementOrder: Number(event.target.value) as 1 | 2 })
              }
            >
              <option value={2}>Quadratic C3D10</option>
              <option value={1}>Linear C3D4</option>
            </select>
          </label>
        </div>
        <div className="mt-3 flex gap-2">
          <Button variant="primary" onClick={() => run.mutate("simulation")} disabled={run.isPending}>
            Run analysis
          </Button>
          <Button onClick={() => activeId && cancelJob(activeId)} disabled={!current?.active}>
            Cancel
          </Button>
        </div>
        {formError && <p className="mt-2 text-xs leading-5 text-amber-700">{formError}</p>}
        <ol className="mt-4 space-y-1 font-mono text-xs">
          {STAGES.map((stage) => (
            <li key={stage} className={stageClass(stage, current)}>
              {stage}
              {current?.status === stage ? ` — ${current.message ?? ""}` : ""}
            </li>
          ))}
        </ol>
        {current?.status === "failed" && <p className="mt-2 text-xs leading-5 text-red-600">{current.error}</p>}
        {current?.status === "cancelled" && <p className="mt-2 text-xs text-gray-500">Cancelled.</p>}
        {result && <ResultReadout result={result} />}
        <label className="mt-3 flex items-center gap-2 text-xs text-gray-500">
          <input type="checkbox" checked={wireframe} onChange={(event) => setWireframe(event.target.checked)} />
          Wireframe
        </label>
        <label className="field mt-2">
          <span>Visual scale {formatEngineering(visualScale, 2)}×</span>
          <input
            type="range"
            min={0}
            max={Math.max(80, visualScale)}
            step={0.1}
            value={visualScale}
            onChange={(event) => setVisualScale(Number(event.target.value))}
          />
        </label>
        <p className="text-[11px] leading-4 text-gray-500">
          The slider exaggerates displacement for display. 1× is the physical result.
        </p>
        <div className="mt-4 border-t border-gray-200 pt-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Thickness study</h2>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <NumberField label="Lower mm" value={lowerMm} onChange={setLowerMm} />
            <NumberField label="Upper mm" value={upperMm} onChange={setUpperMm} />
            <NumberField label="Min factor" value={minimumFactor} onChange={setMinimumFactor} />
          </div>
          <Button className="mt-2" onClick={() => run.mutate("optimization")} disabled={run.isPending}>
            Optimize with FEM
          </Button>
        </div>
        {activeId && current?.status === "completed" && (
          <div className="mt-3 flex flex-col gap-1 text-xs">
            {["model.step", "preview.glb", "results.glb", "model.inp", "model.dat", "model.frd", "model.vtu", "results.json"].map(
              (name) => (
                <a key={name} className="text-indigo-600 hover:underline" href={artifactUrl(activeId, name)}>
                  {name}
                </a>
              ),
            )}
          </div>
        )}
      </aside>

      <section className="col-span-3 grid grid-cols-[minmax(0,1fr)_360px] border-t border-gray-200 bg-white">
        <div className="overflow-auto">
          <table className="w-full text-left font-mono text-xs">
            <thead className="text-gray-500">
              <tr>
                <th className="px-3 py-2">Job</th>
                <th>Status</th>
                <th>Mass kg</th>
                <th>Displacement mm</th>
                <th>Factor</th>
                <th>Check</th>
              </tr>
            </thead>
            <tbody>
              {(jobs.data ?? []).map((item) => (
                <tr
                  key={item.id}
                  className={item.id === activeId ? "bg-indigo-50" : "hover:bg-slate-50"}
                  onClick={() => setActiveId(item.id)}
                >
                  <td className="cursor-pointer px-3 py-1">{item.id.slice(0, 8)}</td>
                  <td>{item.status}</td>
                  <td>{item.summary?.mass_kg == null ? "—" : formatEngineering(item.summary.mass_kg)}</td>
                  <td>
                    {item.summary?.max_displacement_m == null
                      ? "—"
                      : formatEngineering(mmFromMeters(item.summary.max_displacement_m))}
                  </td>
                  <td>{item.summary?.safety_factor == null ? "—" : formatEngineering(item.summary.safety_factor, 3)}</td>
                  <td>{item.summary?.validation_status ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <pre className="overflow-auto border-l border-gray-200 bg-slate-50 p-3 font-mono text-[11px] leading-4 text-gray-600">
          {log.data?.solver || log.data?.worker || "Solver log appears after the job starts."}
        </pre>
      </section>
    </div>
  );
}

function ResultReadout({ result }: { result: SimulationResult }) {
  const benchmark = result.benchmark;
  return (
    <dl className="mt-3 space-y-1 font-mono text-xs">
      <Row label="Solver" value={result.solver.version} />
      <Row label="Mesh" value={`${result.mesh.elements} ${result.mesh.element_type}`} />
      <Row label="Mass" value={`${formatEngineering(result.mass_kg)} kg`} />
      <Row label="Max displacement" value={`${formatEngineering(mmFromMeters(result.max_displacement_m))} mm`} />
      <Row label="Governing von Mises" value={`${formatEngineering(mpaFromPascals(result.governing_von_mises_pa))} MPa`} />
      <Row label="Peak von Mises" value={`${formatEngineering(mpaFromPascals(result.max_von_mises_pa))} MPa`} />
      <Row label="Safety factor" value={formatEngineering(result.safety_factor, 3)} />
      <Row label="Validation" value={result.validation_status} />
      {benchmark.applicable && (
        <>
          <Row
            label="Tip deflection"
            value={`${formatEngineering(mmFromMeters(benchmark.fem_tip_deflection_m ?? 0))} / ${formatEngineering(mmFromMeters(benchmark.analytical_tip_deflection_m ?? 0))} mm`}
          />
          <Row label="Deflection error" value={percent(benchmark.deflection_error)} />
          <Row label="Midspan stress error" value={percent(benchmark.stress_error)} />
        </>
      )}
      {result.warnings.map((warning) => (
        <p key={warning} className="pt-1 text-[11px] leading-4 text-amber-700">
          {warning}
        </p>
      ))}
    </dl>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function stageClass(stage: (typeof STAGES)[number], job: Job | undefined) {
  if (!job) return "text-gray-400";
  if (job.status === stage) return "font-medium text-indigo-600";
  const current = STAGES.indexOf(job.status as (typeof STAGES)[number]);
  const index = STAGES.indexOf(stage);
  if (current >= 0 && index < current) return "text-gray-900";
  return "text-gray-400";
}

function modelExtent(surface: SimulationResult["surface"]) {
  let extent = 0;
  for (const vertex of surface.vertices_m) {
    extent = Math.max(extent, Math.abs(vertex[0]), Math.abs(vertex[1]), Math.abs(vertex[2]));
  }
  return extent || 1;
}

function percent(value: number | undefined) {
  if (value == null) return "—";
  return `${(value * 100).toFixed(2)}%`;
}
