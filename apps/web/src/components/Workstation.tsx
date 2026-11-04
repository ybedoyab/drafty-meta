import { Box, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CircleAlert, Magnet, MousePointer2, PenTool, Pencil, Redo2, RotateCcw, RotateCw, Rows3, Scaling, Trash2, Undo2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Viewport, type CameraView, type DraftSketch, type EditMode, type PartTransform, type Shade } from "@/components/Viewport";
import { DrawTool } from "@/components/DrawTool";
import { GridControl } from "@/components/GridControl";
import { Button } from "@/components/ui/button";
import {
  artifactUrl,
  cancelJob,
  createJob,
  getHealth,
  getJob,
  getScenario,
  getJobs,
  getLog,
  getMaterials,
  getOptimization,
  getResults,
  openArtifact,
  interpret,
  previewSpec,
  returnStudioSpec,
  uploadReference,
  type Job,
  type SimulationResult,
} from "@/lib/api";
import { turbo } from "@/lib/colormap";
import { DEFAULT_GRID_STEP_MM, gridStepMeters } from "@/lib/grid";
import { loadDirection } from "@/lib/markers";
import {
  SURFACES,
  benchmarkForm,
  formIssues,
  formToSpec,
  isSpecChanged,
  formatEngineering,
  withGeometry,
  mmFromMeters,
  mpaFromPascals,
  specToForm,
  type DesignForm,
  type DesignSpec,
  type PartKind,
} from "@/lib/design";
import { canRedo, canUndo, createHistory, historyShortcut, recordHistory, redoHistory, undoHistory, type History } from "@/lib/history";
import { gateLabel, summarizeMeshQuality } from "@/lib/meshQuality";
import { takeStudioSpec } from "@/lib/scenario";
import { axisSizesMm, hasVisualEdits, rotateForm, scaleForm } from "@/lib/transform";
import { clampOffsets, draftPlacementM, ellipseProfile, type SketchAdditionForm } from "@/lib/sketch";
import { SiteHeader } from "@/components/SiteHeader";

const STAGES = ["queued", "geometry", "meshing", "solving", "postprocessing", "completed"] as const;
const MATERIALS = [
  ["steel_s235", "S235 steel"],
  ["aluminum_6061_t6", "Aluminum 6061-T6"],
  ["stainless_316", "Stainless 316"],
  ["titanium_ti6al4v", "Ti-6Al-4V"],
  ["abs", "ABS"],
] as const;

type DesignStepId = "part" | "loads" | "assistant";
type RunStepId = "run" | "results" | "view" | "optimize";
type StudioStep = { id: string; label: string; hint: string; status: "done" | "attention" | "todo"; badge?: string };

export function Workstation() {
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const scenarioId = params.get("scenario");
  const navigate = useNavigate();
  const [returning, setReturning] = useState(false);
  const [formHistory, setFormHistory] = useState<History<DesignForm>>(() => createHistory(benchmarkForm));
  const form = formHistory.present;

  // Every edit through setForm records an undo stage. loadForm replaces the
  // part outright (a scenario or example load), so it starts a fresh history.
  function setForm(next: DesignForm | ((current: DesignForm) => DesignForm)) {
    setFormHistory((current) =>
      recordHistory(current, typeof next === "function" ? next(current.present) : next),
    );
  }

  function loadForm(next: DesignForm) {
    setFormHistory(createHistory(next));
  }
  const [baselineForm, setBaselineForm] = useState<DesignForm>(benchmarkForm);
  const [bottomPanel, setBottomPanel] = useState<"edit" | "jobs">("edit");
  const [editMode, setEditMode] = useState<EditMode>("select");
  const [partSelected, setPartSelected] = useState(false);
  const [snapScaleToGrid, setSnapScaleToGrid] = useState(true);
  const [drawOpen, setDrawOpen] = useState(false);
  const [sketchDraft, setSketchDraft] = useState<{ addition: SketchAdditionForm; standalone: boolean } | null>(null);
  const [bottomCollapsed, setBottomCollapsed] = useState(false);
  const [specApplied, setSpecApplied] = useState(false);
  const [compute, setCompute] = useState<"local" | "modal">("local");
  const [displacementLimitM, setDisplacementLimitM] = useState<number | null>(null);

  useEffect(() => {
    // Passive navigation must not POST /api/v1/designs/preview. Spec load restores
    // form state only; geometry generation waits for Preview / edit actions.
    if (!scenarioId) {
      const pending = takeStudioSpec(localStorage);
      if (pending && typeof pending === "object") {
        setSpecApplied(true);
        setBaselineForm(specToForm(pending as DesignSpec, benchmarkForm));
        loadForm(specToForm(pending as DesignSpec, benchmarkForm));
      }
      return;
    }
    let cancel = false;
    getScenario(scenarioId)
      .then((scenario) => {
        if (cancel || scenario.studio_approval !== "confirmed" || !scenario.studio_spec) return;
        setSpecApplied(true);
        setBaselineForm(specToForm(scenario.studio_spec as unknown as DesignSpec, benchmarkForm));
        loadForm(specToForm(scenario.studio_spec as unknown as DesignSpec, benchmarkForm));
        const limit = scenario.inputs.displacement_limit_m;
        if (typeof limit === "number") setDisplacementLimitM(limit);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [scenarioId]);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [chat, setChat] = useState<{ role: "you" | "drafty"; text: string }[]>([]);
  const [imageId, setImageId] = useState<string | null>(null);
  const [wireframe, setWireframe] = useState(false);
  const [gridVisible, setGridVisible] = useState(true);
  const [gridStepMm, setGridStepMm] = useState<number>(DEFAULT_GRID_STEP_MM);
  const [shade, setShade] = useState<Shade>("von_mises");
  const [orthographic, setOrthographic] = useState(false);
  const [cameraView, setCameraView] = useState<CameraView>("iso");
  const [cameraNonce, setCameraNonce] = useState(0);
  const [contourMin, setContourMin] = useState("");
  const [contourMax, setContourMax] = useState("");
  const [iterationCap, setIterationCap] = useState(4);
  const [visualScale, setVisualScale] = useState(1);
  const [lowerMm, setLowerMm] = useState(8);
  const [upperMm, setUpperMm] = useState(16);
  const [minimumFactor, setMinimumFactor] = useState(2);
  const [formError, setFormError] = useState<string | null>(null);
  const [exampleBusy, setExampleBusy] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [stageFull, setStageFull] = useState(false);
  const [designStep, setDesignStep] = useState<DesignStepId>("part");
  const [runStep, setRunStep] = useState<RunStepId>("run");
  const [followRunGuide, setFollowRunGuide] = useState(true);

  const health = useQuery({ queryKey: ["health"], queryFn: getHealth, retry: false, refetchInterval: 15000 });
  useEffect(() => {
    if (health.data?.compute === "modal") setCompute("modal");
  }, [health.data?.compute]);
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
  const materials = useQuery({ queryKey: ["materials"], queryFn: getMaterials, staleTime: 60_000 });
  const optimization = useQuery({
    queryKey: ["optimization", activeId],
    queryFn: () => getOptimization(activeId!),
    enabled: job.data?.kind === "optimization" && job.data?.status === "completed",
  });

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const suggestedScale = useMemo(() => {
    if (!results.data) return 1;
    const physical = results.data.max_displacement_m;
    if (physical <= 0) return 1;
    return Math.min(80, (0.12 * modelExtent(results.data.surface)) / physical);
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
    mutationFn: async (target: DesignForm) => {
      const issues = formIssues(target);
      if (issues.length) throw new Error(issues.join(" "));
      return previewSpec(formToSpec(target));
    },
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
      const issues = formIssues(form);
      if (issues.length) throw new Error(issues.join(" "));
      const spec = formToSpec(form);
      const optimization =
        kind === "optimization"
          ? {
              lower_m: lowerMm / 1000,
              upper_m: upperMm / 1000,
              min_safety_factor: minimumFactor,
              max_iterations: iterationCap,
            }
          : undefined;
      return createJob(
        kind,
        spec,
        kind === "optimization" && displacementLimitM
          ? { ...optimization, max_displacement_m: displacementLimitM }
          : optimization,
        scenarioId,
        compute,
      );
    },
    onSuccess: async (created) => {
      setActiveId(created.id);
      setFormError(null);
      await queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (error: Error) => setFormError(error.message),
  });

  async function loadExample() {
    loadForm(benchmarkForm);
    setBaselineForm(benchmarkForm);
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

  // Close the circle: send the current (maybe edited) spec back so the
  // scenario's inputs, study, and AI context follow what Studio holds. An
  // unchanged part returns without touching the stored session.
  async function returnToScenario() {
    if (!scenarioId || returning) return;
    const issues = formIssues(form);
    if (issues.length) {
      setFormError(issues.join(" "));
      return;
    }
    setReturning(true);
    setFormError(null);
    try {
      await returnStudioSpec(scenarioId, formToSpec(form));
      navigate(`/scenario/${scenarioId}`);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "The part could not be returned to the scenario.");
      setReturning(false);
    }
  }

  function resetPart() {
    const restored = withGeometry(form, baselineForm);
    setForm(restored);
    setFormError(null);
    setShade("geometry");
    preview.mutate(restored);
  }

  // Undo and redo restore a whole stage, then rebuild the solid from it like
  // any other edit. A restored sketch-only part with its piece removed has no
  // solid to build, so the stale preview is dropped instead.
  function restoreForm(restored: DesignForm) {
    setFormError(null);
    setShade("geometry");
    if (restored.kind === "sketch_prism" && restored.additions.length === 0) {
      setPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return null;
      });
      return;
    }
    preview.mutate(restored);
  }

  function undoForm() {
    const next = undoHistory(formHistory);
    if (next === formHistory) return;
    setFormHistory(next);
    restoreForm(next.present);
  }

  function redoForm() {
    const next = redoHistory(formHistory);
    if (next === formHistory) return;
    setFormHistory(next);
    restoreForm(next.present);
  }

  function handlePartTransform(transform: PartTransform) {
    if (transform.type === "scale") {
      const next = scaleForm(form, transform.factors, snapScaleToGrid ? gridStepMm : 0);
      if (axisSizesMm(next).every((size, index) => size === axisSizesMm(form)[index])) return;
      setForm(next);
      setFormError(null);
      setShade("geometry");
      preview.mutate(next);
      return;
    }
    const rotated = rotateForm(form, transform.matrix);
    if (!rotated) {
      setFormError(
        form.kind === "l_bracket"
          ? "An L-bracket cannot be rotated into the same kind of part. Change its leg dimensions instead."
          : "That rotation cannot be written as this kind of part. Holes must stay through the thickness.",
      );
      return;
    }
    setForm(rotated);
    setFormError(null);
    setShade("geometry");
    preview.mutate(rotated);
  }

  function confirmSketchDraft() {
    if (!sketchDraft) return;
    const { addition, standalone } = sketchDraft;
    const next: DesignForm = standalone
      ? {
          ...form,
          kind: "sketch_prism",
          name: form.name.trim() && form.name !== benchmarkForm.name ? form.name : "sketch-part",
          additions: [addition],
          support: "ymin",
          loadSurface: "ymax",
        }
      : { ...form, additions: [...form.additions, addition] };
    const issues = formIssues(next);
    if (issues.length) {
      setFormError(issues.join(" "));
      return;
    }
    setSketchDraft(null);
    setForm(next);
    setFormError(null);
    setShade("geometry");
    preview.mutate(next);
  }

  function removeAddition(id: string) {
    const next = { ...form, additions: form.additions.filter((addition) => addition.id !== id) };
    if (next.kind === "sketch_prism") next.kind = "plate";
    setForm(next);
    setFormError(null);
    setShade("geometry");
    if (form.kind === "sketch_prism") {
      setPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return null;
      });
    } else {
      preview.mutate(next);
    }
  }

  function handleDraftMove(deltaM: [number, number, number]) {
    setSketchDraft((current) => {
      if (!current) return current;
      const placement = draftPlacementM(
        current.standalone ? { ...form, kind: "sketch_prism", additions: [current.addition] } : form,
        current.addition,
      );
      const dot = (axis: [number, number, number]) => deltaM[0] * axis[0] + deltaM[1] * axis[1] + deltaM[2] * axis[2];
      const moved = {
        ...current.addition,
        offsetUMm: current.addition.offsetUMm + dot(placement.uAxis) * 1000,
        offsetWMm: current.addition.offsetWMm + dot(placement.wAxis) * 1000,
      };
      return { ...current, addition: current.standalone ? moved : clampOffsets(form, moved) };
    });
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

  const draftSketchValue: DraftSketch | null = sketchDraft
    ? {
        ...draftPlacementM(
          sketchDraft.standalone ? { ...form, kind: "sketch_prism", additions: [sketchDraft.addition] } : form,
          sketchDraft.addition,
        ),
        // An ellipse piece is a true ellipse in CAD; draw the ghost just as smooth.
        profile: sketchDraft.addition.shape === "ellipse" ? ellipseProfile(64) : sketchDraft.addition.profile,
        label: sketchDraft.addition.label,
      }
    : null;
  const current = job.data;
  const result = results.data;
  const selectedMaterial = materials.data?.find((item) => item.id === form.materialId);
  const fitRadius = useMemo(() => {
    const vertices = result?.surface.vertices_m;
    if (vertices?.length) {
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (const vertex of vertices) {
        vertex.forEach((value, index) => {
          min[index] = Math.min(min[index], value);
          max[index] = Math.max(max[index], value);
        });
      }
      return Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2 || 0.15;
    }
    if (sketchDraft?.standalone && !previewUrl) {
      const addition = sketchDraft.addition;
      return Math.hypot(addition.widthMm, addition.depthMm, addition.heightMm) / 2000 || 0.15;
    }
    const [sizeX, sizeY, sizeZ] = axisSizesMm(form);
    return Math.hypot(sizeX, sizeY, sizeZ) / 2000 || 0.15;
  }, [result, form, sketchDraft, previewUrl]);
  const partHalfHeightM = ((form.kind === "sketch_prism" ? (form.additions[0]?.heightMm ?? form.heightMm) : form.kind === "cantilever_beam" ? form.heightMm : form.thicknessMm) / 1000) / 2;
  const loadAxis = loadDirection([form.directionX, form.directionY, form.directionZ]).axisLabel;
  const loadLabel =
    form.loadMode === "pressure" ? `Pressure ${form.magnitude} MPa ${loadAxis}` : `${form.magnitude} N ${loadAxis}`;
  const fromScenario = Boolean(scenarioId) || specApplied;
  const geometryChanged = hasVisualEdits(form, baselineForm);
  const specChanged = specApplied && isSpecChanged(form, baselineForm);
  // Left defines the model, right runs and reads it. Each side paginates independently.
  const designIssues = formIssues(form);
  const designSteps: StudioStep[] = [
    { id: "part", label: "Part", hint: "What the part is: shape, size, and material.", status: designIssues.length ? "attention" : "done" },
    { id: "loads", label: "Loads", hint: "How it is held and loaded, then preview the solid.", status: form.support === form.loadSurface || !form.magnitude ? "attention" : "done" },
    { id: "assistant", label: "Assistant", hint: "Reference image and design chat. The image is context, not a measurement.", status: imageId || chat.length ? "done" : "todo", badge: chat.length ? String(chat.length) : undefined },
  ];
  const runSteps: StudioStep[] = [
    { id: "run", label: "Run", hint: "Mesh, backend, and starting the solve.", status: current?.status === "completed" ? "done" : current?.status === "failed" || formError ? "attention" : current ? "attention" : "todo" },
    { id: "results", label: "Results", hint: "What the solve returned, and the files it produced.", status: result || optimization.data ? "done" : "todo" },
    { id: "view", label: "View", hint: "How the result is drawn in the viewport. It does not change the solve.", status: result ? "done" : "todo" },
    { id: "optimize", label: "Optimize", hint: "One thickness variable, real solves only.", status: optimization.data ? "done" : "todo" },
  ];
  const suggestedRunStep: RunStepId = !current ? "run" : current.active ? "run" : result ? "results" : "run";
  const activeDesignStep: DesignStepId = designSteps.some((step) => step.id === designStep) ? designStep : "part";
  const activeRunStep: RunStepId = runSteps.some((step) => step.id === runStep) ? runStep : "run";
  const designIndex = Math.max(0, designSteps.findIndex((step) => step.id === activeDesignStep));
  const runIndex = Math.max(0, runSteps.findIndex((step) => step.id === activeRunStep));
  function goDesign(id: string) { setDesignStep(id as DesignStepId); }
  function goRun(id: string) { setFollowRunGuide(false); setRunStep(id as RunStepId); }
  function goDesignRelative(offset: number) { const next = designSteps[designIndex + offset]; if (next) goDesign(next.id); }
  function goRunRelative(offset: number) { const next = runSteps[runIndex + offset]; if (next) goRun(next.id); }
  useEffect(() => { if (followRunGuide) setRunStep(suggestedRunStep); }, [followRunGuide, suggestedRunStep]);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const inField =
        Boolean(target) &&
        (["INPUT", "SELECT", "TEXTAREA"].includes(target!.tagName) || target!.isContentEditable);
      const shortcut = historyShortcut(event);
      if (shortcut && !inField && !drawOpen) {
        // Keep the browser from treating the chord as its own undo/redo.
        event.preventDefault();
        if (shortcut === "undo") undoForm();
        else redoForm();
        return;
      }
      // Inside a field the chord stays with the field's own text undo.
      if (inField) return;
      if (event.key === "1") setEditMode("select");
      else if (event.key === "2") setEditMode("scale");
      else if (event.key === "3") setEditMode("rotate");
      else if (event.key === "4") setDrawOpen(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [formHistory, drawOpen]);

  return (
    <div
      className={`grid h-full grid-cols-[360px_minmax(0,1fr)_320px] bg-slate-100 text-gray-900 ${bottomCollapsed ? "grid-rows-[auto_minmax(0,1fr)_38px]" : bottomPanel === "edit" ? (sketchDraft ? "grid-rows-[auto_minmax(0,1fr)_308px]" : "grid-rows-[auto_minmax(0,1fr)_196px]") : logOpen ? "grid-rows-[auto_minmax(0,1fr)_220px]" : "grid-rows-[auto_minmax(0,1fr)_132px]"}`}
    >
      <SiteHeader
        className="col-span-3"
        trailing={
          <>
            {scenarioId && (
              specApplied ? <button type="button" onClick={() => void returnToScenario()} disabled={returning} className="rounded-md bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-60">
                {returning ? "Returning…" : specChanged ? "Return edited part to scenario" : "Return to scenario"}
              </button> : <Link to={`/scenario/${scenarioId}`} className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-blue-50 hover:text-blue-800">Back to scenario</Link>
            )}
            <p className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-gray-600">
              {health.data
                ? `solver ${health.data.solver.mode} · ${health.data.meta ? "Meta on" : "AI not connected"}`
                : "solver unreachable · AI not connected"}
            </p>
          </>
        }
      />

      <aside className="flex min-h-0 flex-col gap-4 overflow-auto border-r border-gray-200 bg-white p-4">
        <StepNav steps={designSteps} active={activeDesignStep} label="Design" onSelect={goDesign} />
        {activeDesignStep === "part" && (
        <div>
        <h2 className="text-sm font-semibold">Part</h2>
        <p className="mt-1 text-sm text-gray-600">{designSteps[0].hint}</p>
        <div className="mt-3">
        {!fromScenario && (
        <>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-blue-800">Start here</p>
        <button
          type="button"
          onClick={() => void loadExample()}
          disabled={exampleBusy}
          className="mb-4 w-full rounded-2xl border border-blue-100 bg-gradient-to-br from-white to-blue-50 p-4 text-left shadow-sm transition hover:border-blue-300 hover:shadow-md disabled:opacity-60"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-800">Example</p>
          <p className="mt-1 text-sm font-semibold text-gray-900">
            {exampleBusy ? "Building the example solid…" : "Load cantilever example"}
          </p>
          <p className="mt-1 text-xs leading-5 text-gray-500">
            300 × 20 × 12 mm steel beam, fixed at one end, 100 N downward at the free end. No AI key required.
          </p>
        </button>
        </>
        )}
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-blue-800">Part details</p>
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
              <option value="sketch_prism">Sketch part (from Draw)</option>
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
          <p className="col-span-2 mt-2 text-xs text-gray-500">
            {selectedMaterial
              ? `${selectedMaterial.name}: E ${formatEngineering(selectedMaterial.youngs_modulus_pa / 1e9, 3)} GPa, nu ${selectedMaterial.poisson_ratio}, density ${selectedMaterial.density_kg_m3} kg/m3, yield ${formatEngineering(selectedMaterial.yield_strength_pa / 1e6, 3)} MPa. ${selectedMaterial.caveat}`
              : "Typical values near 20 °C. Not a certified material certificate."}
          </p>
        </div>
        </div>
        </div>
        )}
        {activeDesignStep === "loads" && (
        <div>
        <h2 className="text-sm font-semibold">Loads</h2>
        <p className="mt-1 text-sm text-gray-600">{designSteps[1].hint}</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <p className="col-span-2 text-xs font-semibold uppercase tracking-wide text-blue-800">
            Hold and load
          </p>
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
          <Button variant="primary" onClick={() => preview.mutate(form)} disabled={preview.isPending}>
            {preview.isPending ? "Building solid" : "Preview solid"}
          </Button>
        </div>
        <p className="mt-3 text-xs leading-5 text-gray-500">
          Enter exact dimensions. A reference image is stored as context and is not measured.
        </p>
        </div>
        )}
        {activeDesignStep === "assistant" && (
        <div>
        <h2 className="text-sm font-semibold">Assistant</h2>
        <p className="mt-1 text-sm text-gray-600">{designSteps[2].hint}</p>
        <label className="field mt-3">
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
                <span className="font-medium text-blue-800">{entry.role === "you" ? "You" : "Drafty"}: </span>
                {entry.text}
              </p>
            ))}
          </div>
        </div>
        </div>
        )}
        <StepFooter steps={designSteps} activeIndex={designIndex} label="Design" onRelative={goDesignRelative} onSelect={goDesign} />
      </aside>

      <main className={stageFull ? "fixed inset-0 z-30 min-h-0 bg-slate-100" : "relative min-h-0 bg-slate-100"}>
        <Suspense fallback={null}>
          <Viewport
            previewUrl={previewUrl}
            surface={shade === "geometry" && previewUrl ? null : (result?.surface ?? null)}
            scale={visualScale}
            wireframe={wireframe}
            shade={shade}
            orthographic={orthographic}
            cameraView={cameraView}
            cameraNonce={cameraNonce}
            contourMin={contourMin === "" ? null : Number(contourMin) * 1e6}
            contourMax={contourMax === "" ? null : Number(contourMax) * 1e6}
            support={form.support}
            loadSurface={form.loadSurface}
            direction={[form.directionX, form.directionY, form.directionZ]}
            loadLabel={loadLabel}
            fitRadius={fitRadius}
            gridVisible={gridVisible}
            gridStepM={gridStepMeters(gridStepMm)}
            floorOffset={partHalfHeightM}
            editMode={editMode}
            partSelected={partSelected}
            onPartSelectedChange={setPartSelected}
            onPartTransform={handlePartTransform}
            draftSketch={draftSketchValue}
            onDraftMove={handleDraftMove}
          />
        </Suspense>
        <div className="pointer-events-none absolute left-3 top-3 rounded-lg border border-gray-200 bg-white/90 px-3 py-1 text-xs text-gray-500 shadow-sm">
          {result
            ? "Contour max on corner triangles, not a certified stress plot · meters"
            : "CAD preview · meters"}
        </div>
        <div className="absolute left-3 top-12 flex flex-wrap gap-1">
          <GridControl
            visible={gridVisible}
            stepMm={gridStepMm}
            onVisibleChange={setGridVisible}
            onStepChange={setGridStepMm}
          />
          {(["iso", "front", "top", "right"] as const).map((view) => (
            <button
              key={view}
              type="button"
              className="rounded border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-700 shadow-sm"
              onClick={() => {
                setCameraView(view);
                setCameraNonce((value) => value + 1);
              }}
            >
              {view}
            </button>
          ))}
          <button
            type="button"
            className="rounded border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-700 shadow-sm"
            onClick={() => setOrthographic((value) => !value)}
          >
            {orthographic ? "Perspective" : "Orthographic"}
          </button>
          <button
            type="button"
            className="rounded border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-700 shadow-sm"
            onClick={() => setStageFull((value) => !value)}
          >
            {stageFull ? "Exit full view" : "Full view"}
          </button>
        </div>
        {!previewUrl && !result && !activeId && !sketchDraft && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="rounded-2xl border border-blue-100 bg-white px-8 py-6 text-center shadow-lg">
              <p className="text-lg font-semibold text-gray-900">
                {specApplied ? "Preview when you need geometry" : "Ready to generate?"}
              </p>
              <p className="mt-1 text-sm text-gray-500">
                {specApplied
                  ? "Opening Studio does not rebuild CAD. Use Preview solid when you want a new solid."
                  : "Load the example or enter dimensions, then preview the solid."}
              </p>
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
              <span>contour von Mises, including the support</span>
              <span>{formatEngineering(mpaFromPascals(legend.max))} MPa</span>
            </div>
          </div>
        )}
      </main>

      <aside className="flex min-h-0 flex-col gap-4 overflow-auto border-l border-gray-200 bg-white p-4 text-sm">
        <StepNav steps={runSteps} active={activeRunStep} label="Run" suggested={suggestedRunStep} following={followRunGuide} onSelect={goRun} onResumeGuide={() => { setFollowRunGuide(true); setRunStep(suggestedRunStep); }} />
        {activeRunStep === "run" && (
        <div>
        <h2 className="text-sm font-semibold">Run</h2>
        <p className="mt-1 text-sm text-gray-600">{runSteps[0].hint}</p>
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
        <fieldset className="mt-3 space-y-1 text-xs">
          <legend className="font-medium text-gray-700">Execution backend</legend>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="compute"
              checked={compute === "local"}
              disabled={health.data?.compute === "modal"}
              onChange={() => setCompute("local")}
            />
            Local CalculiX
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="compute"
              checked={compute === "modal"}
              disabled={!health.data?.modal_available}
              onChange={() => setCompute("modal")}
            />
            Modal Cloud CalculiX
          </label>
          {!health.data?.modal_available && (
            <p>Modal Cloud CalculiX is off until `modal setup` completes or server tokens are set. Local CalculiX stays available.</p>
          )}
          {current?.compute && <p>This job ran on {current.compute}. Results are stored {current.artifact_storage ?? "local"}.</p>}
          {health.data?.compute === "modal" && (
            <p>This deployment runs CalculiX on Modal. Local CalculiX is not started.</p>
          )}
        </fieldset>
        <div className="mt-3 flex gap-2">
          <Button variant="primary" onClick={() => run.mutate("simulation")} disabled={run.isPending}>
            Run analysis
          </Button>
          <Button onClick={() => activeId && cancelJob(activeId)} disabled={!current?.active}>
            Cancel
          </Button>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          Cancel asks this job's backend to stop. Closing the page does not cancel a Modal job.
        </p>
        {formError && <p className="mt-2 text-xs leading-5 text-amber-700">{formError}</p>}
        <ol className="mt-4 space-y-1 font-mono text-xs">
          {(current?.compute === "modal"
            ? (["queued", "submitted", "running", "transferring", "completed"] as const)
            : STAGES
          ).map((stage) => (
            <li key={stage} className={stageClass(stage, current)}>
              {stage}
              {current?.status === stage ? ` — ${current.message ?? ""}` : ""}
            </li>
          ))}
        </ol>
        {current?.status === "failed" && <p className="mt-2 text-xs leading-5 text-red-600">{current.error}</p>}
        {current?.status === "cancelled" && <p className="mt-2 text-xs text-gray-500">Cancelled.</p>}
        </div>
        )}
        {activeRunStep === "results" && (
        <div>
        <h2 className="text-sm font-semibold">Results</h2>
        <p className="mt-1 text-sm text-gray-600">{runSteps[1].hint}</p>
        {!result && !optimization.data && <p className="mt-3 text-xs leading-5 text-gray-500">No result yet. Run an analysis first, then come back here.</p>}
        {result && <ResultReadout result={result} />}
        {optimization.data && (
          <div className="mt-3 space-y-1 text-xs">
            <p className="font-medium text-gray-700">Submitted versus accepted</p>
            <p>Submitted thickness {optimization.data.submitted?.thickness_m == null ? "—" : formatEngineering(optimization.data.submitted.thickness_m * 1000, 3)} mm</p>
            <p>Accepted thickness {optimization.data.best?.thickness_m == null ? "—" : formatEngineering(optimization.data.best.thickness_m * 1000, 3)} mm</p>
            <p>Submitted mass {optimization.data.submitted?.mass_kg == null ? "—" : formatEngineering(optimization.data.submitted.mass_kg)} kg</p>
            <p>Accepted mass {optimization.data.best?.mass_kg == null ? "—" : formatEngineering(optimization.data.best.mass_kg)} kg</p>
            <p>Submitted displacement {optimization.data.submitted?.displacement_m == null ? "—" : formatEngineering(optimization.data.submitted.displacement_m * 1000, 3)} mm</p>
            <p>Accepted displacement {optimization.data.best?.displacement_m == null ? "—" : formatEngineering(optimization.data.best.displacement_m * 1000, 3)} mm</p>
            <p>Submitted von Mises {optimization.data.submitted?.governing_von_mises_pa == null ? "—" : formatEngineering(mpaFromPascals(optimization.data.submitted.governing_von_mises_pa))} MPa</p>
            <p>Accepted von Mises {optimization.data.best?.governing_von_mises_pa == null ? "—" : formatEngineering(mpaFromPascals(optimization.data.best.governing_von_mises_pa))} MPa</p>
            <p>Exploratory factor {optimization.data.best?.safety_factor == null ? "—" : formatEngineering(optimization.data.best.safety_factor, 3)}. Not a certified safety factor.</p>
            <p className="text-amber-700">{optimization.data.design_status ?? "exploratory candidate"}</p>
            <p className="text-amber-700">{optimization.data.optimality}</p>
            {optimization.data.message && <p className="text-amber-700">{optimization.data.message}</p>}
          </div>
        )}
        </div>
        )}
        {activeRunStep === "view" && (
        <div>
        <h2 className="text-sm font-semibold">View</h2>
        <p className="mt-1 text-sm text-gray-600">{runSteps[2].hint}</p>
        <label className="mt-3 flex items-center gap-2 text-xs text-gray-500">
          <input type="checkbox" checked={wireframe} onChange={(event) => setWireframe(event.target.checked)} />
          Wireframe
        </label>
        <label className="mt-2 flex items-center gap-2 text-xs text-gray-500">
          <span>Shade</span>
          <select value={shade} onChange={(event) => setShade(event.target.value as Shade)}>
            <option value="von_mises">von Mises</option>
            <option value="displacement">Displacement magnitude</option>
            <option value="geometry">Undeformed preview when loaded</option>
          </select>
        </label>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="field">
            <span>Contour min MPa</span>
            <input value={contourMin} onChange={(event) => setContourMin(event.target.value)} />
          </label>
          <label className="field">
            <span>Contour max MPa</span>
            <input value={contourMax} onChange={(event) => setContourMax(event.target.value)} />
          </label>
        </div>
        <p className="mt-1 text-[11px] leading-4 text-gray-500">
          The orange marker is the fixed support on the selected bounding-box face. The red arrow starts at the load-face
          centroid and points in the applied-force direction. It is not the displacement. These six faces are presets,
          not picked B-rep faces.
        </p>
        <label className="field mt-2">
          <span>
            {visualScale === 1 ? "Deformed shape 1× physical" : `Deformed shape ${formatEngineering(visualScale, 2)}× exaggerated`}
          </span>
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
          1× is the physical displacement. Amplify only changes the picture.
        </p>
        <div className="mt-2 flex gap-2">
          <Button type="button" onClick={() => setVisualScale(1)}>
            1× physical
          </Button>
          <Button type="button" onClick={() => setVisualScale(suggestedScale)} disabled={!result}>
            Amplify view
          </Button>
        </div>
        </div>
        )}
        {activeRunStep === "optimize" && (
        <div>
        <h2 className="text-sm font-semibold">Optimize</h2>
        <p className="mt-1 text-sm text-gray-600">{runSteps[3].hint}</p>
        <div className="mt-3 border-t border-gray-200 pt-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Thickness study</h2>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <NumberField label="Lower mm" value={lowerMm} onChange={setLowerMm} />
            <NumberField label="Upper mm" value={upperMm} onChange={setUpperMm} />
            <NumberField label="Min factor" value={minimumFactor} onChange={setMinimumFactor} />
            <NumberField label="Iterations" value={iterationCap} onChange={setIterationCap} />
          </div>
          <p className="mt-2 text-[11px] leading-4 text-gray-500">
            One thickness variable, real solves only. Not a global optimum. The factor stays exploratory.
          </p>
          <Button className="mt-2" onClick={() => run.mutate("optimization")} disabled={run.isPending}>
            Optimize with FEM
          </Button>
        </div>
        </div>
        )}
        {activeRunStep === "results" && activeId && current?.status === "completed" && (
          <div className="mt-3 flex flex-col gap-1 text-xs">
            {["model.step", "preview.glb", "results.glb", "model.inp", "model.dat", "model.frd", "model.vtu", "results.json", "report.json", "report.pdf"].map(
              (name) => (
                <a
                  key={name}
                  className="text-blue-800 hover:underline"
                  href={artifactUrl(activeId, name)}
                  onClick={(event) => {
                    event.preventDefault();
                    void openArtifact(activeId, name);
                  }}
                >
                  {name}
                </a>
              ),
            )}
          </div>
        )}
        <StepFooter steps={runSteps} activeIndex={runIndex} label="Run" onRelative={goRunRelative} onSelect={goRun} />
      </aside>

      <section className={bottomPanel === "edit" ? "col-span-3 flex min-h-0 flex-col border-t border-gray-200 bg-white" : `col-span-3 border-t border-gray-200 bg-white ${logOpen ? "grid grid-cols-[minmax(0,1fr)_360px]" : ""}`}>
        <div className="overflow-auto">
          <div className="flex items-center justify-between px-3 py-1">
            <div className="flex items-center gap-1" role="tablist" aria-label="Bottom panel"><button type="button" role="tab" aria-selected={bottomPanel === "edit"} onClick={() => { setBottomPanel("edit"); setBottomCollapsed(false); }} className={bottomPanel === "edit" ? "inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1 text-xs font-medium text-white" : "inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"}><Pencil className="h-3.5 w-3.5" aria-hidden /> Edition tools</button><button type="button" role="tab" aria-selected={bottomPanel === "jobs"} onClick={() => { setBottomPanel("jobs"); setBottomCollapsed(false); }} className={bottomPanel === "jobs" ? "inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1 text-xs font-medium text-white" : "inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"}><Rows3 className="h-3.5 w-3.5" aria-hidden /> Jobs queue{(jobs.data ?? []).length > 0 && <span className={bottomPanel === "jobs" ? "rounded-full bg-white/20 px-1.5 text-[10px]" : "rounded-full bg-slate-100 px-1.5 text-[10px] text-slate-600"}>{(jobs.data ?? []).length}</span>}</button></div>
            <button type="button" className={bottomPanel === "edit" ? "hidden" : "text-xs text-blue-800"} onClick={() => setLogOpen((value) => !value)}>
              {logOpen ? "Hide solver log" : "Solver log"}
            </button>
            <button
              type="button"
              aria-expanded={!bottomCollapsed}
              aria-label={bottomCollapsed ? "Show the bottom panel" : "Hide the bottom panel"}
              title={bottomCollapsed ? "Show the bottom panel" : "Hide the bottom panel"}
              onClick={() => setBottomCollapsed((value) => !value)}
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              {bottomCollapsed ? <ChevronUp className="h-3.5 w-3.5" aria-hidden /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden />}
              {bottomCollapsed ? "Show" : "Hide"}
            </button>
          </div>
          {!bottomCollapsed && bottomPanel === "edit" && (
            <div className="flex-1 overflow-x-auto px-3 py-2">
              <div className="flex min-w-max items-stretch">
                <div className="flex flex-col">
                  <div className="flex gap-1.5 px-1" role="group" aria-label="Edit mode">
                    {(
                      [
                        ["select", MousePointer2, "Select", "1"],
                        ["scale", Scaling, "Scale", "2"],
                        ["rotate", RotateCw, "Rotate", "3"],
                      ] as const
                    ).map(([mode, Icon, label, shortcut]) => (
                      <button
                        key={mode}
                        type="button"
                        aria-pressed={editMode === mode}
                        title={`${label} (${shortcut})`}
                        onClick={() => setEditMode(mode)}
                        className={
                          editMode === mode
                            ? "flex h-[76px] w-[80px] flex-col items-center justify-center gap-1 rounded-lg bg-slate-900 text-white shadow-sm"
                            : "flex h-[76px] w-[80px] flex-col items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                        }
                      >
                        <Icon className="h-7 w-7" aria-hidden />
                        <span className="text-xs font-semibold">{label}</span>
                        <span className={editMode === mode ? "text-[10px] text-slate-300" : "text-[10px] text-slate-400"}>{shortcut}</span>
                      </button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-center text-[10px] font-semibold uppercase tracking-widest text-slate-400">Transform</p>
                </div>
                <div className="mx-3 w-px shrink-0 bg-slate-200" aria-hidden />
                <div className="flex flex-col">
                  <div className="flex gap-1.5 px-1">
                    <button
                      type="button"
                      aria-pressed={snapScaleToGrid}
                      title="Snap scaled dimensions to the grid step"
                      onClick={() => setSnapScaleToGrid((value) => !value)}
                      className={
                        snapScaleToGrid
                          ? "flex h-[76px] w-[80px] flex-col items-center justify-center gap-1 rounded-lg bg-slate-900 text-white shadow-sm"
                          : "flex h-[76px] w-[80px] flex-col items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                      }
                    >
                      <Magnet className="h-7 w-7" aria-hidden />
                      <span className="text-xs font-semibold">Snap</span>
                      <span className={snapScaleToGrid ? "text-[10px] text-slate-300" : "text-[10px] text-slate-400"}>{gridStepMm} mm grid</span>
                    </button>
                  </div>
                  <p className="mt-1.5 text-center text-[10px] font-semibold uppercase tracking-widest text-slate-400">Precision</p>
                </div>
                <div className="mx-3 w-px shrink-0 bg-slate-200" aria-hidden />
                <div className="flex flex-col">
                  <div className="flex gap-1.5 px-1">
                    <button
                      type="button"
                      title="Draw a sketch piece to add to this part (4)"
                      onClick={() => setDrawOpen(true)}
                      className="flex h-[76px] w-[80px] flex-col items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                    >
                      <PenTool className="h-7 w-7" aria-hidden />
                      <span className="text-xs font-semibold">Draw</span>
                      <span className="text-[10px] text-slate-400">add a piece · 4</span>
                    </button>
                  </div>
                  <p className="mt-1.5 text-center text-[10px] font-semibold uppercase tracking-widest text-slate-400">Add</p>
                </div>
                <div className="mx-3 w-px shrink-0 bg-slate-200" aria-hidden />
                <div className="flex min-w-[230px] flex-col justify-center px-1">
                  <p className="text-sm font-semibold text-gray-900">
                    {
                      {
                        cantilever_beam: "Cantilever beam",
                        plate: "Plate",
                        l_bracket: "L-bracket",
                        perforated_plate: "Perforated plate",
                        sketch_prism: "Sketch part",
                      }[form.kind]
                    }
                  </p>
                  <p className="mt-0.5 font-mono text-xs text-gray-600">
                    {axisSizesMm(form).map((size) => formatEngineering(size)).join(" x ")} mm
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {selectedMaterial?.name ?? form.materialId} - {partSelected ? "part selected" : "no part selected"}
                  </p>
                  {geometryChanged && (
                    <span className="mt-1.5 w-fit rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                      {fromScenario ? "Modified from the proposed part" : "Modified from the loaded part"}
                    </span>
                  )}
                  <p className="mt-1.5 text-center text-[10px] font-semibold uppercase tracking-widest text-slate-400">Part</p>
                </div>
                <div className="flex-1" />
                <div className="flex flex-col">
                  <div className="flex gap-1.5 px-1" role="group" aria-label="History">
                    <button
                      type="button"
                      disabled={!canUndo(formHistory)}
                      title="Undo the last edit (Ctrl+Z)"
                      onClick={undoForm}
                      className="flex h-[76px] w-[80px] flex-col items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Undo2 className="h-7 w-7" aria-hidden />
                      <span className="text-xs font-semibold">Undo</span>
                      <span className="text-[10px] text-slate-400">Ctrl+Z</span>
                    </button>
                    <button
                      type="button"
                      disabled={!canRedo(formHistory)}
                      title="Redo the undone edit (Ctrl+Y or Ctrl+Shift+Z)"
                      onClick={redoForm}
                      className="flex h-[76px] w-[80px] flex-col items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Redo2 className="h-7 w-7" aria-hidden />
                      <span className="text-xs font-semibold">Redo</span>
                      <span className="text-[10px] text-slate-400">Ctrl+Y</span>
                    </button>
                  </div>
                  <p className="mt-1.5 text-center text-[10px] font-semibold uppercase tracking-widest text-slate-400">History</p>
                </div>
                <div className="mx-3 w-px shrink-0 bg-slate-200" aria-hidden />
                <div className="flex flex-col">
                  <div className="flex gap-1.5 px-1">
                    <button
                      type="button"
                      disabled={!geometryChanged}
                      title="Restore the part as loaded and rebuild it"
                      onClick={resetPart}
                      className="flex h-[76px] w-[80px] flex-col items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <RotateCcw className="h-7 w-7" aria-hidden />
                      <span className="text-xs font-semibold">Reset</span>
                      <span className="text-[10px] text-slate-400">as loaded</span>
                    </button>
                    <button
                      type="button"
                      disabled={preview.isPending}
                      title="Rebuild the solid from the edited part"
                      onClick={() => preview.mutate(form)}
                      className="flex h-[76px] w-[80px] flex-col items-center justify-center gap-1 rounded-lg bg-blue-700 text-white shadow-sm hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Box className="h-7 w-7" aria-hidden />
                      <span className="text-xs font-semibold">{preview.isPending ? "Building" : "Preview"}</span>
                      <span className="text-[10px] text-blue-200">rebuild solid</span>
                    </button>
                  </div>
                  <p className="mt-1.5 text-center text-[10px] font-semibold uppercase tracking-widest text-slate-400">Apply</p>
                </div>
              </div>
              <p className="mt-1 text-[11px] leading-4 text-gray-500">
                Click the part in the viewport to select it, then drag the gizmo handles. Scale writes the dragged size back into
                the dimensions; Rotate turns in 90-degree steps and remaps the support and load faces. Ctrl+Z steps back through
                your edits and Ctrl+Y steps forward again.
                {form.kind === "l_bracket" && " Rotating an L-bracket cannot be written as the same kind of part, so Rotate does not apply to it."}
                {form.kind === "perforated_plate" && " Holes stay through the thickness, so tipping a perforated plate on its edge is not offered."}
                {form.kind === "sketch_prism" && " This part is one drawn piece. Hold and load it on its back and front faces, or draw a new piece to change its outline."}
              </p>
              {sketchDraft && (
                <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
                  <p className="text-sm font-semibold text-blue-900">
                    Placing: {sketchDraft.addition.label}
                    <span className="block text-xs font-normal text-blue-800">
                      {sketchDraft.standalone ? "Sketch-only part. " : `On ${sketchDraft.addition.face}. `}
                      Drag the blue piece in the viewport, or type its offsets. It stays flat on its face.
                    </span>
                  </p>
                  <label className="field">
                    <span>Across mm</span>
                    <input type="number" value={Math.round(sketchDraft.addition.offsetUMm * 10) / 10} onChange={(event) => setSketchDraft((current) => current && { ...current, addition: current.standalone ? { ...current.addition, offsetUMm: Number(event.target.value) } : clampOffsets(form, { ...current.addition, offsetUMm: Number(event.target.value) }) })} />
                  </label>
                  <label className="field">
                    <span>Along mm</span>
                    <input type="number" value={Math.round(sketchDraft.addition.offsetWMm * 10) / 10} onChange={(event) => setSketchDraft((current) => current && { ...current, addition: current.standalone ? { ...current.addition, offsetWMm: Number(event.target.value) } : clampOffsets(form, { ...current.addition, offsetWMm: Number(event.target.value) }) })} />
                  </label>
                  <Button type="button" variant="primary" onClick={confirmSketchDraft}>Add this piece</Button>
                  <Button type="button" onClick={() => setSketchDraft(null)}>Discard</Button>
                </div>
              )}
              {form.additions.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Sketch pieces</span>
                  {form.additions.map((addition) => (
                    <span key={addition.id} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700">
                      {addition.label} · {addition.face} · {formatEngineering(addition.widthMm)} × {formatEngineering(addition.heightMm)} × {formatEngineering(addition.depthMm)} mm
                      <button type="button" aria-label={`Remove ${addition.label}`} title={`Remove ${addition.label}`} onClick={() => removeAddition(addition.id)} className="text-slate-400 hover:text-red-600">
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {formError && <p className="mt-1 text-[11px] leading-4 text-amber-700">{formError}</p>}
            </div>
          )}
          {!bottomCollapsed && bottomPanel === "jobs" && (
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
                  className={item.id === activeId ? "bg-blue-50" : "hover:bg-slate-50"}
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
          )}
        </div>
        {!bottomCollapsed && bottomPanel === "jobs" && logOpen && (
          <pre className="overflow-auto border-l border-gray-200 bg-slate-50 p-3 font-mono text-[11px] leading-4 text-gray-600">
            {log.data?.solver || log.data?.worker || "Solver log appears after the job starts."}
          </pre>
        )}
      </section>
      {drawOpen && (
        <DrawTool
          form={form}
          hasPart={Boolean(previewUrl || result)}
          gridStepMm={gridStepMm}
          onClose={() => setDrawOpen(false)}
          onDraft={(addition, standalone) => {
            setSketchDraft({ addition, standalone });
            setDrawOpen(false);
            setBottomPanel("edit");
            setBottomCollapsed(false);
          }}
        />
      )}
    </div>
  );
}

function StepNav({ steps, active, label, suggested, following, onSelect, onResumeGuide }: { steps: StudioStep[]; active: string; label: string; suggested?: string; following?: boolean; onSelect: (id: string) => void; onResumeGuide?: () => void }) {
  const suggestedLabel = steps.find((step) => step.id === suggested)?.label ?? suggested;
  return (
    <section className="sticky top-0 z-10 rounded-lg border border-gray-200 bg-white py-1" aria-label={label}>
      <nav className={steps.length > 3 ? "grid grid-cols-2 gap-1.5" : "flex gap-1.5"} aria-label={`${label} steps`}>
        {steps.map((step, index) => {
          const isActive = step.id === active;
          return (
            <button key={step.id} type="button" onClick={() => onSelect(step.id)} aria-current={isActive ? "step" : undefined} className={isActive ? "inline-flex min-w-0 flex-1 items-center justify-center gap-1 rounded-full bg-slate-900 px-1.5 py-1.5 text-xs font-medium text-white" : "inline-flex min-w-0 flex-1 items-center justify-center gap-1 rounded-full border border-slate-200 bg-white px-1.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"}>
              {step.status === "done" ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden /> : step.status === "attention" ? <CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <span className="shrink-0 text-[10px] text-slate-400" aria-hidden>{index + 1}</span>}
              <span className="truncate">{step.label}</span>
              {step.badge && <span className={isActive ? "shrink-0 rounded-full bg-white/20 px-1.5 text-[10px]" : "shrink-0 rounded-full bg-slate-100 px-1.5 text-[10px] text-slate-600"}>{step.badge}</span>}
              {suggested && step.id === suggested && !isActive && <span className="text-[10px] font-normal text-slate-400">suggested</span>}
            </button>
          );
        })}
      </nav>
      {onResumeGuide && !following && suggested !== active && (
        <button type="button" onClick={onResumeGuide} className="mt-3 text-xs font-medium text-slate-800 underline">Go to suggested step: {suggestedLabel}</button>
      )}
    </section>
  );
}
function StepFooter({ steps, activeIndex, label, onRelative, onSelect }: { steps: StudioStep[]; activeIndex: number; label: string; onRelative: (offset: number) => void; onSelect: (id: string) => void }) {
  const next = steps[activeIndex + 1];
  const prev = steps[activeIndex - 1];
  if (!prev && !next) return null;
  return (
    <nav className="sticky bottom-0 z-10 mt-auto flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-2" aria-label={`${label} pagination`}>
      <Button type="button" className="min-w-0 flex-1 px-2 text-xs" disabled={!prev} onClick={() => onRelative(-1)}><ChevronLeft className="mr-1 h-4 w-4 shrink-0" aria-hidden /><span className="truncate">{prev ? prev.label : "Back"}</span></Button>
      <span className="shrink-0 text-xs text-slate-500">{activeIndex + 1} / {steps.length}</span>
      {next ? <Button type="button" variant="primary" className="min-w-0 flex-1 px-2 text-xs" onClick={() => onSelect(next.id)}><span className="truncate">Next: {next.label}</span><ChevronRight className="ml-1 h-4 w-4 shrink-0" aria-hidden /></Button> : <Button type="button" disabled className="min-w-0 flex-1 px-2 text-xs"><span className="truncate">Last step</span></Button>}
    </nav>
  );
}
function ResultReadout({ result }: { result: SimulationResult }) {
  const benchmark = result.benchmark;
  const meshQuality = summarizeMeshQuality(result.mesh.quality, result.mesh);
  const gates = result.quality_gates;
  return (
    <div className="mt-3 space-y-4" data-testid="result-readout">
      <section aria-labelledby="result-solver-heading">
        <h3 id="result-solver-heading" className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Solver completion
        </h3>
        <dl className="mt-1 space-y-1 font-mono text-xs">
          <Row label="Solver" value={result.solver.version} />
          <Row label="Status" value={result.validation_status} />
          <Row label="Mass" value={`${formatEngineering(result.mass_kg)} kg`} />
          <Row label="Max displacement" value={`${formatEngineering(mmFromMeters(result.max_displacement_m))} mm`} />
          <Row label="Governing von Mises" value={`${formatEngineering(mpaFromPascals(result.governing_von_mises_pa))} MPa`} />
          <Row label="Contour peak von Mises" value={`${formatEngineering(mpaFromPascals(result.max_von_mises_pa))} MPa`} />
          <Row label="Exploratory factor" value={formatEngineering(result.safety_factor, 3)} />
        </dl>
        {result.stress_assessment && (
          <p className="pt-1 text-[11px] leading-4 text-amber-700">
            {result.stress_assessment.safety_factor_status}. {result.stress_assessment.exclusion}.{" "}
            {result.stress_assessment.exclusion_reason} {result.stress_assessment.mesh_sensitivity}
          </p>
        )}
        <p className="pt-1 text-[11px] leading-4 text-amber-700">
          The factor uses governing stress away from the fixed face. The contour peak stays visible and can be higher
          because of the support singularity.{" "}
          {result.stress_assessment?.safety_factor_status === "unreliable"
            ? "This governing sample is not reliable enough to accept a design."
            : "This is not a certified safety factor."}
        </p>
      </section>

      <section aria-labelledby="result-gates-heading" data-testid="quality-gates">
        <h3 id="result-gates-heading" className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Validation gates
        </h3>
        <p className="mt-1 text-[11px] leading-4 text-slate-500">
          Solver completion, mesh validity, numerical equilibrium, and engineering feasibility are reported separately.
        </p>
        <dl className="mt-1 space-y-1 font-mono text-xs">
          <Row
            label="Solver completed"
            value={gateLabel(gates?.solver_completed ?? (result.validation_status ? true : null))}
          />
          <Row
            label="Mesh validity"
            value={gateLabel(gates?.mesh_validity ?? (meshQuality.legacyOnly ? "legacy" : null))}
          />
          <Row
            label="Mesh quality"
            value={gateLabel(gates?.mesh_quality ?? (meshQuality.available ? (meshQuality.legacyOnly ? "legacy" : "reported") : null))}
          />
          <Row
            label="Equilibrium"
            value={
              gates?.equilibrium_verified != null
                ? gateLabel(gates.equilibrium_verified)
                : result.equilibrium
                  ? result.equilibrium.passed
                    ? "passed"
                    : "failed"
                  : "—"
            }
          />
          <Row
            label="Engineering feasibility"
            value={gateLabel(
              gates?.validated_feasibility ??
                (result.stress_assessment?.safety_factor_status === "unreliable" ? false : null),
            )}
          />
          <Row label="Stress assessment" value={gateLabel(gates?.stress_assessment ?? result.stress_assessment?.safety_factor_status)} />
        </dl>
        {result.equilibrium && (
          <p className="pt-1 text-[11px] leading-4 text-slate-600">
            Force balance:{" "}
            {result.equilibrium.passed
              ? "reactions match the load"
              : "residual above the 0.1% balance check"}
            .
          </p>
        )}
      </section>

      <section aria-labelledby="result-mesh-heading" data-testid="mesh-quality">
        <h3 id="result-mesh-heading" className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Mesh quality
        </h3>
        {!meshQuality.available ? (
          <p className="mt-1 text-[11px] leading-4 text-slate-500">Mesh quality metadata is not available for this job.</p>
        ) : (
          <>
            {meshQuality.legacyOnly && (
              <p className="mt-1 text-[11px] leading-4 text-amber-700" data-testid="mesh-quality-legacy">
                Historical job — Batch 10A Jacobian fields are not present. Showing legacy mesh summary only.
              </p>
            )}
            <dl className="mt-1 space-y-1 font-mono text-xs">
              <Row label="Element type" value={meshQuality.elementType} />
              <Row label="Element count" value={meshQuality.elementCount} />
              <Row label="Jacobian method" value={meshQuality.method} />
              <Row label="Jacobian status" value={meshQuality.status} />
              <Row label="Min determinant" value={meshQuality.minJacobian} />
              <Row label="Max determinant" value={meshQuality.maxJacobian} />
              <Row label="Normalized quality ratio" value={meshQuality.ratioMin} />
              <Row label="Inverted elements" value={meshQuality.inverted} />
              <Row label="Degenerate elements" value={meshQuality.degenerate} />
              <Row label="Inconclusive elements" value={meshQuality.inconclusive} />
              <Row label="Whole-element certification" value={meshQuality.wholeElementLabel} />
            </dl>
            <p className="pt-1 text-[11px] leading-4 text-slate-600" data-testid="mesh-certification-note">
              {meshQuality.certificationNote}
            </p>
            {meshQuality.softWarnings.map((warning) => (
              <p key={warning} className="pt-1 text-[11px] leading-4 text-amber-700" data-testid="mesh-soft-warning">
                Soft quality warning: {warning}
              </p>
            ))}
          </>
        )}
      </section>

      {benchmark.applicable && (
        <section aria-labelledby="result-benchmark-heading">
          <h3 id="result-benchmark-heading" className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Benchmark
          </h3>
          <dl className="mt-1 space-y-1 font-mono text-xs">
            <Row
              label="Tip deflection"
              value={`${formatEngineering(mmFromMeters(benchmark.fem_tip_deflection_m ?? 0))} / ${formatEngineering(mmFromMeters(benchmark.analytical_tip_deflection_m ?? 0))} mm`}
            />
            <Row label="Deflection error" value={percent(benchmark.deflection_error)} />
            <Row label="Midspan stress error" value={percent(benchmark.stress_error)} />
          </dl>
        </section>
      )}

      {result.warnings.map((warning) => (
        <p key={warning} className="text-[11px] leading-4 text-amber-700">
          {warning}
        </p>
      ))}
    </div>
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

function stageClass(stage: string, job: Job | undefined) {
  const order = [
    "queued",
    "submitted",
    "running",
    "geometry",
    "meshing",
    "solving",
    "postprocessing",
    "transferring",
    "completed",
  ];
  if (!job) return "text-gray-400";
  if (job.status === stage) return "font-medium text-blue-800";
  const current = order.indexOf(job.status);
  const index = order.indexOf(stage);
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
