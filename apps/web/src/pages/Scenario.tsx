import { Box, Check, ChevronLeft, ChevronRight, CircleAlert, GraduationCap, PanelRightClose, PanelRightOpen } from "lucide-react";
import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Link, useNavigate } from "react-router-dom";
import { Fragment, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { Logo } from "@/components/Logo";
import { SiteHeader } from "@/components/SiteHeader";
import { BeamResults } from "@/components/BeamResults";
import { Viewport } from "@/components/Viewport";
import { GridControl } from "@/components/GridControl";
import { MicButton, SpeakButton } from "@/components/Voice";
import { ModelPicker } from "@/components/ModelPicker";
import { Button } from "@/components/ui/button";
import {
  analyzeScenario,
  approveScenario,
  confirmScenarioFaces,
  getJob,
  rejectScenario,
  createScenario,
  deleteScenarioEvidence,
  dismissScenario,
  downloadScenarioGeometry,
  downloadScenarioReport,
  getHealth,
  getModels,
  getScenario,
  loadDemo,
  scenarioEvidenceUrl,
  scenarioGeometryUrl,
  segmentScenario,
  turnScenario,
  uploadScenarioEvidence,
  type ScenarioSession,
} from "@/lib/api";
import {
  ANALYSIS_LABEL,
  CAPABILITIES_PATH,
  CLASSROOM_PROMPT,
  emptyForm,
  fieldLabel,
  formFields,
  formFromInputs,
  groupFields,
  inputsFromForm,
  isMetaModelId,
  META_MODELS,
  metaModel,
  messageSegments,
  recallModelId,
  rememberModelId,
  recallScenarioId,
  rememberScenarioId,
  scenarioFields,
  stageStudioSpec,
  type PartInput,
  type PartSummary,
  type ScenarioForm,
} from "@/lib/scenario";
import { DEFAULT_GRID_STEP_MM, gridStepMeters } from "@/lib/grid";

const IBEAM = "simply_supported_ibeam";
function withArticle(noun: string): string {
  return `${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun}`;
}

/** Form text for every chat part, from the registry the server sent with this session. */
function formOf(session: ScenarioSession): ScenarioForm {
  return formFromInputs(session.inputs, scenarioFields(session.part_catalog));
}

const PHASE_LABEL: Record<string, string> = {
  unsupported: "Part not supported yet",
  collecting: "Collecting the problem",
  asking: "Asking for missing data",
  "interpreting-evidence": "Reading attached images",
  searching: "Reviewing retrieved sources",
  "building-model": "Preliminary model ready",
  verifying: "Beam-element results ready",
};

const WORKFLOW = ["understand", "research", "model", "validate", "simulate", "optimize"] as const;

type InspectorStepId = "inputs" | "evidence" | "model" | "basis" | "results";
type InspectorStep = {
  id: InspectorStepId;
  label: string;
  hint: string;
  status: "done" | "attention" | "todo";
  badge?: string;
};

export function Scenario() {
  const [session, setSession] = useState<ScenarioSession | null>(null);
  const [form, setForm] = useState<ScenarioForm>(emptyForm);
  const [draft, setDraft] = useState("");
  const [role, setRole] = useState("photo");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metaReady, setMetaReady] = useState(false);
  const [models, setModels] = useState(META_MODELS);
  const [selectedModelId, setSelectedModelId] = useState<string>(() => recallModelId(localStorage));
  const [segmentPrompt, setSegmentPrompt] = useState("bracket");
  const [supportFace, setSupportFace] = useState("");
  const [loadFace, setLoadFace] = useState("");
  const [bracket, setBracket] = useState({ legX: "80", legZ: "80", width: "40", thickness: "8", force: "200", limit: "1" });
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [inspectorStep, setInspectorStep] = useState<InspectorStepId>("inputs");
  const [followGuide, setFollowGuide] = useState(true);
  const evidenceRef = useRef<HTMLInputElement | null>(null);
  const [linkedJobs, setLinkedJobs] = useState<Awaited<ReturnType<typeof getJob>>[]>([]);
  const [geometryUrl, setGeometryUrl] = useState<string | null>(null);
  const [geometryError, setGeometryError] = useState<string | null>(null);
  const turnAbort = useRef<AbortController | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let cancel = false;
    getHealth()
      .then((health) => {
        if (!cancel) setMetaReady(health.meta);
      })
      .catch(() => {
        if (!cancel) setMetaReady(false);
      });
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    let cancel = false;
    const saved = recallScenarioId(localStorage);
    // load the saved scenario, or create a fresh one below
    const load = async () => {
      if (saved) {
        try {
          return await getScenario(saved);
        } catch (reason) {
          if (!(reason instanceof Error) || !/not found|404/i.test(reason.message)) throw reason;
        }
      }
      return createScenario();
    };
    load()
      .then((next) => {
        if (cancel) return;
        rememberScenarioId(localStorage, next.id);
        setSession(next);
        setForm(formOf(next));
      })
      .catch((reason) => {
        if (!cancel) setError(reason instanceof Error ? reason.message : "The scenario service is unavailable.");
      });
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    const ids = session?.jobs ?? [];
    if (!ids.length) {
      setLinkedJobs([]);
      return;
    }
    let cancel = false;
    Promise.all(ids.map((item) => getJob(item.id).catch(() => null))).then((jobs) => {
      if (!cancel) setLinkedJobs(jobs.filter((job) => job !== null));
    });
    return () => {
      cancel = true;
    };
  }, [session?.jobs]);

  const geometryKey = session?.geometry_spec ? JSON.stringify(session.geometry_spec.profile) : "";
  useEffect(() => {
    setGeometryUrl(null);
    setGeometryError(null);
    if (!session || !geometryKey) return;
    let cancel = false;
    let created: string | null = null;
    scenarioGeometryUrl(session.id, "preview.glb")
      .then((url) => {
        if (cancel) URL.revokeObjectURL(url);
        else {
          created = url;
          setGeometryUrl(url);
        }
      })
      .catch((reason) => {
        if (!cancel) setGeometryError(reason instanceof Error ? reason.message : "The preview could not be built.");
      });
    return () => {
      cancel = true;
      if (created) URL.revokeObjectURL(created);
    };
    // The preview depends only on the stored profile, not on every session field.
  }, [session?.id, geometryKey]);

  async function downloadGeometry(name: string) {
    if (!session?.geometry_spec) return;
    setError(null);
    try {
      const suffix = name.slice(name.lastIndexOf("."));
      await downloadScenarioGeometry(session.id, name, `${session.geometry_spec.profile.name}${suffix}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The file could not be built.");
    }
  }

  useEffect(() => {
    let cancel = false;
    getModels()
      .then((body) => {
        if (cancel || !body.models?.length) return;
        setModels(body.models);
        setSelectedModelId((current) => (isMetaModelId(body.models, current) ? current : body.default_model));
      })
      .catch(() => {
        // The built-in Spark/Wonder list stays usable if the catalog is unreachable.
      });
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    const sessionModel = session?.model;
    if (isMetaModelId(models, sessionModel)) setSelectedModelId(sessionModel);
  }, [models, session?.model]);

  function chooseModel(id: string) {
    if (!isMetaModelId(models, id)) return;
    setSelectedModelId(id);
    rememberModelId(localStorage, id);
  }

  async function submit(message: string, patch?: ScenarioForm) {
    if (!session) return;
    const nextForm = { ...form, ...patch };
    setForm(nextForm);
    turnAbort.current?.abort();
    const controller = new AbortController();
    turnAbort.current = controller;
    setBusy(true);
    setError(null);
    try {
      const fields = formFields(session.part_catalog?.form_part);
      const next = await turnScenario(session.id, { message, inputs: inputsFromForm(nextForm, fields), model: selectedModelId }, controller.signal);
      if (controller.signal.aborted) return;
      setSession(next);
      setForm(formOf(next));
      setDraft("");
    } catch (reason) {
      if (controller.signal.aborted) {
        setError("This browser stopped waiting. A request already at the server may still finish.");
        return;
      }
      setError(reason instanceof Error ? reason.message : "The turn failed.");
    } finally {
      if (turnAbort.current === controller) setBusy(false);
    }
  }

  function cancelTurn() {
    turnAbort.current?.abort();
  }

  async function loadPreset(kind: "classroom" | "bracket") {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const overrides =
        kind === "bracket"
          ? {
              leg_x_m: Number(bracket.legX) / 1000,
              leg_z_m: Number(bracket.legZ) / 1000,
              bracket_width_m: Number(bracket.width) / 1000,
              bracket_thickness_m: Number(bracket.thickness) / 1000,
              force_n: Number(bracket.force),
              displacement_limit_m: Number(bracket.limit) / 1000,
            }
          : undefined;
      const next = await loadDemo(kind, session.id, overrides);
      rememberScenarioId(localStorage, next.id);
      setSession(next);
      setForm(formOf(next));
      if (next.suggested_faces) {
        setSupportFace(next.suggested_faces.support_face);
        setLoadFace(next.suggested_faces.load_face);
      }
      setDraft("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The demo could not be loaded.");
    } finally {
      setBusy(false);
    }
  }

  async function startFresh() {
    setBusy(true);
    setError(null);
    try {
      const next = await createScenario();
      rememberScenarioId(localStorage, next.id);
      setSession(next);
      setForm(emptyForm());
      setDraft("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "A new scenario could not be opened.");
    } finally {
      setBusy(false);
    }
  }

  async function addFiles(files: FileList | File[] | null) {
    if (!session || !files) return;
    setError(null);
    for (const file of Array.from(files)) {
      try {
        const next = await uploadScenarioEvidence(session.id, file, role, note);
        setSession(next);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "The image was rejected.");
        break;
      }
    }
  }

  async function removeImage(evidenceId: string) {
    if (!session) return;
    const next = await deleteScenarioEvidence(session.id, evidenceId);
    setSession(next);
  }

  async function runBeam(compare: boolean) {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const next = await analyzeScenario(session.id, {
        method: "euler-bernoulli",
        elements: 16,
        compare,
        inputs: inputsFromForm(form, formFields(session.part_catalog?.form_part)),
      });
      setSession(next);
      if (!compare) setForm(formOf(next));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The beam analysis failed.");
    } finally {
      setBusy(false);
    }
  }

  async function downloadReport() {
    if (!session) return;
    setError(null);
    try {
      await downloadScenarioReport(session.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The report is not available.");
    }
  }

  async function confirmFaces() {
    if (!session || !supportFace || !loadFace || supportFace === loadFace) return;
    setBusy(true);
    setError(null);
    try {
      setSession(await confirmScenarioFaces(session.id, supportFace, loadFace));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The faces could not be confirmed.");
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!session?.studio_spec) return;
    setBusy(true);
    setError(null);
    try {
      const next = await approveScenario(session.id);
      stageStudioSpec(localStorage, next.studio_spec);
      navigate(`/studio?scenario=${next.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The model could not be approved.");
      setBusy(false);
    }
  }

  async function reject() {
    if (!session?.studio_spec) return;
    setBusy(true);
    setError(null);
    try {
      setSession(await rejectScenario(session.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The proposal could not be rejected.");
    } finally {
      setBusy(false);
    }
  }

  async function segment(evidenceId: string) {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      setSession(await segmentScenario(session.id, evidenceId, segmentPrompt));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Segmentation did not run.");
    } finally {
      setBusy(false);
    }
  }

  async function dismiss() {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      setSession(await dismissScenario(session.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The suggestion could not be dismissed.");
    } finally {
      setBusy(false);
    }
  }

  const connected = session?.mode === "meta-responses";
  const questions = session?.model_questions ?? [];
  const domain = session?.engineering?.domain ?? "unknown";
  const workflow = session?.workflow ?? "understand";
  const catalog = session?.part_catalog;
  const unsupported = catalog?.status === "unsupported";
  const formPart = catalog?.form_part ?? null;
  const isBeamForm = formPart?.id === IBEAM;
  const inputFields = formPart ? formFields(formPart) : [];
  const filledInputs = inputFields.filter((field) => (form[field.name] ?? "").trim() !== "").length;
  const evidenceCount = session?.evidence.length ?? 0;
  const hasModelStep = isBeamForm || Boolean(session?.geometry_spec);
  const inspectorSteps: InspectorStep[] = [
    // Missing items are shown inside Inputs, where they can be fixed.
    ...(formPart ? [{ id: "inputs", label: "Inputs", hint: "The numbers and choices Drafty is using, one group at a time.", status: filledInputs >= inputFields.length ? "done" : "attention", badge: `${filledInputs}/${inputFields.length}` } satisfies InspectorStep] : []),
    { id: "evidence", label: "Evidence", hint: "Photos or drawings that support the description. They are not measured drawings.", status: evidenceCount > 0 ? "done" : "todo", badge: evidenceCount > 0 ? String(evidenceCount) : undefined },
    ...(hasModelStep ? [{ id: "model", label: isBeamForm ? "Load path" : "Model", hint: isBeamForm ? "How the load travels to the supports, before any result is trusted." : "The geometry built from your description.", status: session?.analysis || session?.geometry_spec ? "done" : "todo" } satisfies InspectorStep] : []),
    { id: "basis", label: "Basis", hint: "Assumptions and sources behind the numbers, kept separate from the numbers.", status: (session?.assumptions.length ?? 0) + (session?.sources.length ?? 0) > 0 ? "done" : "todo" },
    { id: "results", label: "Results", hint: "Run the check, review the result, and decide what happens next.", status: session?.analysis || session?.studio_spec || linkedJobs.length > 0 ? "done" : domain === "mechanical" ? "attention" : "todo" },
  ];
  const suggestedStep: InspectorStepId = !session ? "inputs" : unsupported ? "results" : session.missing.length > 0 && formPart ? "inputs" : formPart && filledInputs < inputFields.length ? "inputs" : domain === "mechanical" && session.studio_spec ? "results" : session.analysis ? "results" : hasModelStep ? "model" : formPart ? "inputs" : "evidence";
  const activeStep: InspectorStepId = inspectorSteps.some((step) => step.id === inspectorStep) ? inspectorStep : (inspectorSteps[0]?.id ?? "inputs");
  const activeIndex = Math.max(0, inspectorSteps.findIndex((step) => step.id === activeStep));
  function goToStep(id: InspectorStepId) { setFollowGuide(false); setInspectorStep(id); }
  function goRelative(offset: number) { const next = inspectorSteps[activeIndex + offset]; if (next) goToStep(next.id); }
  useEffect(() => { if (followGuide) setInspectorStep(suggestedStep); }, [followGuide, suggestedStep]);
  return (
    <div className="flex h-screen flex-col bg-slate-100 text-slate-900">
      <SiteHeader />
      <main
        className={`grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 ${
          inspectorOpen
            ? "lg:grid-cols-[240px_minmax(0,1fr)_minmax(340px,460px)]"
            : "lg:grid-cols-[240px_minmax(0,1fr)]"
        }`}
      >
        <aside className="space-y-3 overflow-auto rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Project</p>
          <p className="text-sm font-medium">{session?.demo ? `Demo ${session.demo.version}` : "Working scenario"}</p>
          <ol className="space-y-1 text-sm">
            {WORKFLOW.map((stage) => (
              <li key={stage} className={stage === workflow ? "rounded-md bg-slate-900 px-2 py-1 font-medium text-white" : "rounded-md px-2 py-1 text-slate-600"}>
                {stage}
              </li>
            ))}
          </ol>
          <div className="space-y-2 border-t border-slate-200 pt-3">
            <Button className="w-full gap-2" type="button" variant="primary" disabled={busy || !session} onClick={() => void loadPreset("classroom")}>
              <GraduationCap className="h-4 w-4" aria-hidden />
              Load Classroom Demo
            </Button>
            <Button className="w-full gap-2" type="button" disabled={busy || !session} onClick={() => void loadPreset("bracket")}>
              <Box className="h-4 w-4" aria-hidden />
              Load Bracket Demo
            </Button>
          </div>
          <p className="text-xs leading-5 text-slate-500">Demo values are assumptions. They are not a measured building and not an approved design.</p>
        </aside>
        <section className="flex min-h-0 min-w-0 flex-col rounded-xl border border-slate-200 bg-white">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                <span className="block">{PHASE_LABEL[session?.phase ?? "collecting"] ?? "Collecting the problem"}</span>
                <span className="mt-1 block normal-case tracking-normal">
                  {connected ? `${metaModel(models, session?.model ?? selectedModelId).name} · Responses API` : metaReady ? `${metaModel(models, selectedModelId).name} ready` : "AI not connected"}
                </span>
              </p>
              <h1 className="text-xl font-semibold">Scenario assistant</h1>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button className="gap-2" type="button" onClick={() => setInspectorOpen((open) => !open)}>
                {inspectorOpen ? <PanelRightClose className="h-4 w-4" aria-hidden /> : <PanelRightOpen className="h-4 w-4" aria-hidden />}
                {inspectorOpen ? "Hide inspector" : "Show inspector"}
              </Button>
              <Button type="button" onClick={() => void startFresh()} disabled={busy}>
                New scenario
              </Button>
              <Link to="/studio" className="inline-flex items-center text-sm font-medium text-slate-800 underline">
                Open Studio manually
              </Link>
            </div>
          </header>
          {session?.tool_trace && session.tool_trace.length > 0 && (
            <ol className="space-y-2 border-b border-slate-200 px-4 py-3 text-xs text-slate-700">
              {session.tool_trace.map((item, index) => (
                <li key={`${item.tool}-${index}`}>
                  <p>
                    {index + 1}. {item.tool} · {item.status}
                    {item.authorization === "user_confirmation" ? " · approval required" : ""}
                  </p>
                  <p className="text-slate-600">{item.detail}</p>
                </li>
              ))}
              <li className="text-slate-500">
                Simulator: {session.engineering?.simulator ?? "none"}. A selected tool name is not a finished solve.
              </li>
            </ol>
          )}
            {session?.demo && (
              <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-950">
                {session.demo.label} {session.demo.version}.
              </p>
            )}
            <div className="flex-1 space-y-3 overflow-auto px-4 py-4">
            {(session?.messages ?? []).map((entry, index) => (
              <article
                key={`${entry.role}-${index}`}
                className={
                  entry.role === "user"
                    ? "ml-8 rounded-xl bg-slate-900 px-3 py-2 text-sm leading-6 text-white"
                    : "mr-8 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-6"
                }
              >
                <p className={`text-xs font-semibold uppercase tracking-wide ${entry.role === "user" ? "text-slate-300" : "text-slate-500"}`}>{entry.role === "user" ? "You" : "Drafty"}</p>
                <p>{entry.role === "assistant" ? <ReplyText text={entry.text} /> : entry.text}</p>
                {entry.role === "assistant" && <SpeakButton text={entry.text} />}
              </article>
            ))}
            {session && session.messages.length === 0 && (
              <div className="flex min-h-full flex-col items-center justify-center gap-6 text-center">
                <Logo variant="gear" className="h-24 w-24 opacity-20 sm:h-28 sm:w-28" />
                <p className="max-w-md text-sm leading-6 text-slate-600">
                  Describe the structure in your own words. Drafty will ask for what is missing and will not turn a floor
                  beam into the cantilever solver.
                </p>
              </div>
            )}
          </div>
          <form
            className="sticky bottom-0 border-t border-slate-200 bg-white p-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submit(draft);
            }}
          >
            <label className="block text-sm font-medium" htmlFor="scenario-draft">
              Describe the problem
            </label>
            <textarea
              id="scenario-draft"
              className="mt-2 min-h-28 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={draft}
              placeholder={CLASSROOM_PROMPT}
              onChange={(event) => setDraft(event.target.value)}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" disabled={busy || !session} onClick={() => evidenceRef.current?.click()}>
                Attach
              </Button>
              <MicButton
                disabled={busy || !session}
                onTranscript={(text) => setDraft((current) => (current ? `${current} ${text}` : text))}
                onError={setError}
              />
              <div className="ml-auto">
                <ModelPicker models={models} value={selectedModelId} onChange={chooseModel} disabled={busy || !session} configured={metaReady} />
              </div>
              <Button type="submit" variant="primary" disabled={busy || !session || !draft.trim()}>
                Send
              </Button>
            </div>
            {error && <p className="mt-3 text-sm text-amber-800">{error}</p>}
            {busy && (
              <div className="mt-3 flex items-center gap-3 text-sm text-slate-600">
                <p>Working. Cancel stops this browser wait. It does not cancel a solver.</p>
                <Button type="button" onClick={cancelTurn}>
                  Cancel
                </Button>
              </div>
            )}
            {session?.session_usage && session.session_usage.requests > 0 && (
              <p className="mt-3 text-xs text-slate-500">
                This session used {session.session_usage.input_tokens} input tokens and {session.session_usage.output_tokens} output tokens.
                No dollar amount is available.
              </p>
            )}
          </form>
        </section>

        {inspectorOpen && (
        <aside className="flex min-h-0 min-w-0 flex-col gap-4 overflow-auto">
          <InspectorNav steps={inspectorSteps} active={activeStep} suggested={suggestedStep} following={followGuide} onSelect={goToStep} onResumeGuide={() => { setFollowGuide(true); setInspectorStep(suggestedStep); }} />
          {unsupported && catalog && <SupportedParts parts={catalog.parts} requested={catalog.requested_part} />}
          {activeStep === "inputs" && formPart && (
          <Panel title="Inputs" description={inspectorSteps.find((step) => step.id === "inputs")?.hint}>
            <p className="mb-2 text-xs text-slate-500">{formPart.name}. Values are stored in SI and checked on the server.</p>
            {(session?.missing.length ?? 0) > 0 && (
              <div className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-950">
                <p className="font-medium">Still needed</p>
                <ul className="mt-1 list-disc space-y-1 pl-4">
                  {(session?.missing ?? []).map((item) => (<li key={item}>{item}</li>))}
                </ul>
              </div>
            )}
            {questions.length > 0 && (
              <div className="mb-3 text-sm">
                <ul className="list-disc space-y-1 pl-4">
                  {questions.map((item) => (<li key={item}>{item}</li>))}
                </ul>
                <Button className="mt-2" type="button" disabled={busy} onClick={() => void dismiss()}>Reject suggestion</Button>
              </div>
            )}
            {isBeamForm && session?.inputs.student_count ? (
              <p className="mb-2 text-sm">Occupancy context: {session.inputs.student_count} students. A headcount is not a floor load.</p>
            ) : null}
            {session?.demo?.kind === "bracket" && formPart.id === "l_bracket" ? (
              <p className="text-sm text-slate-600">Edit the demo numbers in the Results step.</p>
            ) : (
              groupFields(formFields(formPart)).map(([group, fields]) => (
                <details key={group} open className="border-b border-slate-200 py-2">
                  <summary className="cursor-pointer text-sm font-medium">{group}</summary>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {fields.map((field) => (
                      <PartField
                        key={field.name}
                        field={field}
                        value={form[field.name] ?? ""}
                        onChange={(value) => setForm({ ...form, [field.name]: value })}
                      />
                    ))}
                  </div>
                </details>
              ))
            )}
            {isBeamForm && (
              <Button
                className="mt-3"
                type="button"
                disabled={busy || !session}
                onClick={() => void submit("Use the Colombia classroom minimum.", { jurisdiction: "Colombia" })}
              >
                Use Colombia NSR-10 classroom minimum
              </Button>
            )}
          </Panel>
          )}
          {activeStep === "model" && session?.geometry_spec && (
            <GeometryPanel
              spec={session.geometry_spec}
              previewUrl={geometryUrl}
              error={geometryError}
              description={isBeamForm ? undefined : inspectorSteps.find((step) => step.id === "model")?.hint}
              onDownload={(name) => void downloadGeometry(name)}
            />
          )}
          {activeStep === "evidence" && (
          <Panel title="Evidence" description={inspectorSteps.find((step) => step.id === "evidence")?.hint}>
            <div
              className="rounded-md border border-dashed border-slate-300 p-3"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                void addFiles(event.dataTransfer.files);
              }}
            >
              <label className="text-sm">
                Evidence images
                <input
                  ref={evidenceRef}
                  className="mt-2 block w-full text-sm"
                  aria-label="Evidence images"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  onChange={(event) => void addFiles(event.target.files)}
                />
              </label>
              <label className="mt-2 block text-sm">
                Role
                <select className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1" value={role} onChange={(event) => setRole(event.target.value)}>
                  <option value="photo">photo</option>
                  <option value="drawing">drawing</option>
                  <option value="screenshot">screenshot</option>
                  <option value="context">context</option>
                </select>
              </label>
              <label className="mt-2 block text-sm">
                Note
                <input className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1" value={note} onChange={(event) => setNote(event.target.value)} />
              </label>
            </div>
            <ul className="mt-3 space-y-2">
              {(session?.evidence ?? []).map((item) => (
                <li key={item.id} className="flex items-center gap-2 text-sm">
                  <img
                    alt={item.name}
                    className="h-12 w-12 rounded border border-slate-200 object-cover"
                    src={scenarioEvidenceUrl(session!.id, item.id)}
                  />
                  <span className="min-w-0 flex-1">
                    {item.name}
                    <span className="block text-xs text-slate-500">{item.role}. Not a measured drawing.</span>
                  </span>
                  <button type="button" onClick={() => void segment(item.id)} disabled={busy}>
                    Segment
                  </button>
                  <button type="button" onClick={() => void removeImage(item.id)}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <label className="mt-3 block text-sm">
              Object to segment
              <input
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
                value={segmentPrompt}
                onChange={(event) => setSegmentPrompt(event.target.value)}
              />
            </label>
            {session?.segmentation && (
              <p className="mt-2 text-sm">{session.segmentation.limit}</p>
            )}
            {session?.segmentation?.objects.map((object) => {
              const width = session.segmentation?.width || Math.max(object.right, 1);
              const height = session.segmentation?.height || Math.max(object.bottom, 1);
              return (
                <svg key={object.object_id} viewBox={`0 0 ${width} ${height}`} className="mt-2 h-40 w-full rounded border border-slate-200 bg-slate-50">
                  <rect x={object.left} y={object.top} width={Math.max(object.right - object.left, 1)} height={Math.max(object.bottom - object.top, 1)} fill="none" stroke="#1e40af" />
                  {object.path && <path d={object.path} transform={`translate(${object.left} ${object.top})`} fill="rgba(30,64,175,0.22)" />}
                </svg>
              );
            })}
          </Panel>
          )}
          {activeStep === "model" && isBeamForm && (
          <div className="min-w-0 space-y-4">
          <Panel title="Load path" description={inspectorSteps.find((step) => step.id === "model")?.hint}>
            <BeamFigure
              span={session?.inputs.span_m ?? null}
              lineLoad={session?.calculation?.q_line_n_per_m ?? null}
              reaction={session?.beam?.end_shear_n ?? null}
              solved={Boolean(session?.analysis)}
            />
            {session?.calculation && (
              <p className="mt-2 font-mono text-sm">
                {session.calculation.trace?.formula ?? "q_line"} = {session.calculation.q_line_n_per_m.toFixed(1)} N/m.
                Live load {session.calculation.live_n_per_m2} N/m².
              </p>
            )}
            {session?.beam && (
              <p className="mt-2 text-sm">
                Elastic simple-span check, not FEA: moment {session.beam.max_moment_n_m.toFixed(1)} N·m, each reaction{" "}
                {session.beam.end_shear_n.toFixed(1)} N, midspan deflection {(session.beam.midspan_deflection_m * 1000).toFixed(3)} mm.
                {session.beam.material ? ` Material ${session.beam.material.name} (${session.beam.material.source}).` : ""}
              </p>
            )}
            {session?.section && (
              <p className="mt-2 font-mono text-sm">
                A {session.section.area_m2.toExponential(3)} m², Ix {session.section.inertia_x_m4.toExponential(3)} m⁴, Iy{" "}
                {session.section.inertia_y_m4.toExponential(3)} m⁴.
              </p>
            )}
            <ProfilePreview form={form} spanM={session?.inputs.span_m ?? null} />
          </Panel>
          </div>
          )}
          {activeStep === "basis" && (
          <div className="space-y-4">
            <Panel title="Assumptions" description={inspectorSteps.find((step) => step.id === "basis")?.hint}>
              <ul className="space-y-2 text-sm">
                {(session?.assumptions ?? []).length === 0 && <li className="text-slate-600">No assumptions recorded yet. They will appear here as Drafty works.</li>}
                {(session?.assumptions ?? []).map((item) => (
                  <li key={item.name}>
                    <span className="font-medium">{item.status}.</span> {item.statement}
                    {(item.source || item.provenance) && (
                      <span className="mt-1 block text-xs text-slate-500">Source: {item.source || item.provenance}</span>
                    )}
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel title="Sources">
              <ul className="space-y-3 text-sm">
                {(session?.sources ?? []).length === 0 && <li className="text-slate-600">No sources yet. Checked references and retrieved pages will be listed here, separately.</li>}
                {(session?.sources ?? []).map((item, index) => (
                  <li key={`${item.origin}-${item.url ?? item.title}-${index}`}>
                    <p className="font-medium">{item.title}</p>
                    <p className="text-slate-600">{item.evidence_class ? `${item.evidence_class}. ` : ""}{item.status}. {item.limit}</p>
                    {item.url && (
                      <a className="underline" href={item.url}>
                        {item.url}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
          )}
          {activeStep === "results" && (
          <Panel title="Results" description={inspectorSteps.find((step) => step.id === "results")?.hint}>
            {domain === "mechanical" && session?.studio_spec && (
              <div className="space-y-2 text-sm">
                <p>Parametric L-bracket, CAD schema. Simulator: CalculiX solid FEM, not started.</p>
                <p>
                  Fixed face {session.inputs.support_face || "unset"}, load face {session.inputs.load_face || "unset"}.
                  These faces were confirmed here. This is not a minimum-mass result.
                </p>
                {session.studio_approval === "rejected" ? (
                  <p>This proposal was rejected. Revise the description and send again. CalculiX has not started.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" disabled={busy} onClick={() => void approve()}>
                      Approve and open Studio
                    </Button>
                    <Button type="button" disabled={busy} onClick={() => void reject()}>
                      Reject proposal
                    </Button>
                  </div>
                )}
              </div>
            )}
            {domain === "mechanical" && session?.demo?.kind === "bracket" && (
              <div className="mb-3 grid gap-2 sm:grid-cols-2">
                {(
                  [
                    ["Leg X mm", "legX"],
                    ["Leg Z mm", "legZ"],
                    ["Width mm", "width"],
                    ["Thickness mm", "thickness"],
                    ["Force N", "force"],
                    ["Displacement limit mm", "limit"],
                  ] as const
                ).map(([label, key]) => (
                  <label key={key} className="block text-sm">
                    {label}
                    <input
                      className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
                      aria-label={label}
                      value={bracket[key]}
                      onChange={(event) => setBracket({ ...bracket, [key]: event.target.value })}
                    />
                  </label>
                ))}
                <Button type="button" disabled={busy} onClick={() => void loadPreset("bracket")}>
                  Update bracket numbers
                </Button>
              </div>
            )}
            {domain === "mechanical" && !session?.studio_spec && session?.missing.includes("fixed face and load face") && session.missing.length === 1 && (
              <div className="space-y-2 text-sm">
                <p>Choose the fixed face and the load face. Drafty does not assume them.</p>
                <label className="block">
                  Fixed face
                  <select className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1" value={supportFace} onChange={(event) => setSupportFace(event.target.value)}>
                    <option value="">Choose a face</option>
                    {["xmin", "xmax", "ymin", "ymax", "zmin", "zmax"].map((face) => (
                      <option key={face} value={face}>{face}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  Load face
                  <select className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1" value={loadFace} onChange={(event) => setLoadFace(event.target.value)}>
                    <option value="">Choose a face</option>
                    {["xmin", "xmax", "ymin", "ymax", "zmin", "zmax"].map((face) => (
                      <option key={face} value={face}>{face}</option>
                    ))}
                  </select>
                </label>
                <Button type="button" disabled={busy || !supportFace || !loadFace || supportFace === loadFace} onClick={() => void confirmFaces()}>
                  Confirm faces
                </Button>
              </div>
            )}
            {domain === "mechanical" && !session?.studio_spec && !(session?.missing.length === 1 && session.missing.includes("fixed face and load face")) && (
              <p className="text-sm">The bracket is missing geometry or a force. No mesh was created.</p>
            )}
            {linkedJobs.length > 0 && (
              <ul className="mt-3 space-y-2 text-sm">
                {linkedJobs.map((job) => (
                  <li key={job.id}>
                    {job.kind} · {job.status}
                    {job.status === "completed" && job.summary ? ` · mass ${job.summary.mass_kg ?? "—"} kg · displacement ${job.summary.max_displacement_m ?? "—"} m` : ""}
                    {job.status === "failed" ? ` · failed: ${job.error ?? "the solver did not finish"}` : ""}
                    <span className="block text-xs text-slate-500">CalculiX solid FEM. Not a certification. Scenario {session?.id}.</span>
                  </li>
                ))}
              </ul>
            )}
            {domain === "structural" && session && (
              <BeamResults
                session={session}
                busy={busy}
                runLabel={session.demo?.kind === "classroom" ? "Run Demo Analysis" : "Run beam elements"}
                onRun={() => void runBeam(false)}
                onCompare={() => void runBeam(true)}
                onDownload={() => void downloadReport()}
              />
            )}
            {domain === "unknown" && <p className="text-sm">No solver is selected yet.</p>}
            {unsupported && <p className="text-sm">No solver exists for this request. Nothing was built or started.</p>}
            {domain === "geometry" && (
              <p className="text-sm">No solver exists for this part. It is geometry only: no structural check was run.</p>
            )}
            {!session && <p className="text-sm">The scenario is still loading.</p>}
            <ul className="mt-3 list-disc space-y-1 pl-4 text-sm text-slate-700">
              {(session?.verification ?? []).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </Panel>
          )}
          <InspectorFooter steps={inspectorSteps} activeIndex={activeIndex} onRelative={goRelative} onSelect={goToStep} />
        </aside>
        )}
      </main>
    </div>
  );
}

function InspectorNav({ steps, active, suggested, following, onSelect, onResumeGuide }: { steps: InspectorStep[]; active: InspectorStepId; suggested: InspectorStepId; following: boolean; onSelect: (id: InspectorStepId) => void; onResumeGuide: () => void }) {
  const suggestedLabel = steps.find((step) => step.id === suggested)?.label ?? suggested;
  return (
    <section className="sticky top-0 z-10 rounded-lg border border-slate-200 bg-white p-4" aria-label="Inspector">
      <nav className="flex flex-wrap gap-1.5" aria-label="Inspector steps">
        {steps.map((step, index) => {
          const isActive = step.id === active;
          return (
            <button key={step.id} type="button" onClick={() => onSelect(step.id)} aria-current={isActive ? "step" : undefined} className={isActive ? "inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white" : "inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"}>
              {step.status === "done" ? <Check className="h-3.5 w-3.5" aria-hidden /> : step.status === "attention" ? <CircleAlert className="h-3.5 w-3.5" aria-hidden /> : <span className="text-[10px] text-slate-400" aria-hidden>{index + 1}</span>}
              {step.label}
              {step.badge && <span className={isActive ? "rounded-full bg-white/20 px-1.5 text-[10px]" : "rounded-full bg-slate-100 px-1.5 text-[10px] text-slate-600"}>{step.badge}</span>}
              {step.id === suggested && !isActive && <span className="text-[10px] font-normal text-slate-400">suggested</span>}
            </button>
          );
        })}
      </nav>
      {!following && suggested !== active && (
        <button type="button" onClick={onResumeGuide} className="mt-3 text-xs font-medium text-slate-800 underline">Go to suggested step: {suggestedLabel}</button>
      )}
    </section>
  );
}
function InspectorFooter({ steps, activeIndex, onRelative, onSelect }: { steps: InspectorStep[]; activeIndex: number; onRelative: (offset: number) => void; onSelect: (id: InspectorStepId) => void }) {
  const next = steps[activeIndex + 1];
  const prev = steps[activeIndex - 1];
  if (!prev && !next) return null;
  return (
    <nav className="sticky bottom-0 z-10 mt-auto flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-3" aria-label="Inspector pagination">
      <Button type="button" disabled={!prev} onClick={() => onRelative(-1)}><ChevronLeft className="mr-1 h-4 w-4" aria-hidden />{prev ? prev.label : "Back"}</Button>
      <span className="text-xs text-slate-500">{activeIndex + 1} / {steps.length}</span>
      {next ? <Button type="button" variant="primary" onClick={() => onSelect(next.id)}>Next: {next.label}<ChevronRight className="ml-1 h-4 w-4" aria-hidden /></Button> : <span className="text-xs font-medium text-slate-600">Last step</span>}
    </nav>
  );
}
function Panel({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {description && <p className="mt-1 text-sm text-slate-600">{description}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function PartField({ field, value, onChange }: { field: PartInput; value: string; onChange: (value: string) => void }) {
  if (field.kind === "choice") {
    return (
      <label className="text-sm">
        {fieldLabel(field)}
        <select className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1" value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">Not chosen</option>
          {field.choices.map((choice) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </select>
      </label>
    );
  }
  return <Field label={fieldLabel(field)} value={value} onChange={onChange} />;
}

function GeometryPanel({
  spec,
  previewUrl,
  error,
  onDownload,
  description,
}: {
  description?: string;
  spec: NonNullable<ScenarioSession["geometry_spec"]>;
  previewUrl: string | null;
  error: string | null;
  onDownload: (name: string) => void;
}) {
  const [gridVisible, setGridVisible] = useState(true);
  const [gridStepMm, setGridStepMm] = useState<number>(DEFAULT_GRID_STEP_MM);
  const points = spec.profile.points;
  const height = points.length ? points[points.length - 1].height_m - points[0].height_m : 0;
  const width = 2 * Math.max(0, ...points.map((point) => point.radius_m));
  return (
    <Panel title="Geometry" description={description}>
      <div className="relative h-64 rounded border border-slate-200">
        <div className="absolute left-2 top-2 z-10">
          <GridControl
            visible={gridVisible}
            stepMm={gridStepMm}
            onVisibleChange={setGridVisible}
            onStepChange={setGridStepMm}
          />
        </div>
        <Suspense fallback={null}>
          <Viewport
            previewUrl={previewUrl}
            surface={null}
            scale={1}
            wireframe={false}
            shade="geometry"
            orthographic={false}
            cameraView="iso"
            cameraNonce={0}
            contourMin={null}
            contourMax={null}
            support=""
            loadSurface=""
            direction={[0, 0, -1]}
            loadLabel=""
            fitRadius={Math.max(height, width) / 2}
            gridVisible={gridVisible}
            gridStepM={gridStepMeters(gridStepMm)}
            floorOffset={height / 2}
            zUp
          />
        </Suspense>
        {!previewUrl && (
          <p className="absolute inset-x-0 top-1/2 text-center text-sm text-slate-500">{error ?? "Building the preview."}</p>
        )}
      </div>
      <p className="mt-2 text-sm">
        Revolved profile, {points.length} points, {(height * 1000).toFixed(1)} mm tall, {(width * 1000).toFixed(1)} mm across.
        Volume {(spec.volume_m3 * 1e6).toFixed(2)} cm³, calculated from the profile.
      </p>
      <p className="mt-1 text-sm text-slate-600">Geometry only. No structural check was run. Files are in millimetres.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" onClick={() => onDownload("model.step")}>
          Download STEP
        </Button>
        <Button type="button" onClick={() => onDownload("model.stl")}>
          Download STL
        </Button>
      </div>
    </Panel>
  );
}

function SupportedParts({ parts, requested }: { parts: PartSummary[]; requested: string | null }) {
  return (
    <Panel title="Supported parts">
      <p className="text-sm">
        Drafty can't model {requested ? withArticle(requested) : "that request"} yet. No geometry, file, or calculation was created. It can model:
      </p>
      <ul className="mt-2 space-y-2 text-sm">
        {parts.map((part) => (
          <li key={part.id}>
            <span className="font-medium">{part.name}</span>
            <span className="text-slate-500"> · {part.where === "scenario" ? "this chat" : "Studio"}</span>
            <span className="block text-slate-600">{part.description}</span>
            <span className="block text-xs text-slate-500">
              {part.analysis.map((item) => ANALYSIS_LABEL[item] ?? item).join(", ")}. Exports {part.exports.join(", ")}.
            </span>
          </li>
        ))}
      </ul>
      <Link to={CAPABILITIES_PATH} className="mt-3 inline-block text-sm font-medium text-slate-800 underline">
        See everything Drafty can and cannot do
      </Link>
    </Panel>
  );
}

function ReplyText({ text }: { text: string }) {
  return (
    <>
      {messageSegments(text).map((part, index) =>
        part.link ? (
          <Fragment key={index}>
            (
            <Link to={part.text} target="_blank" rel="noopener noreferrer" className="font-medium underline">
              {part.text}
            </Link>
            )
          </Fragment>
        ) : (
          <Fragment key={index}>{part.text}</Fragment>
        ),
      )}
    </>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="text-sm">
      {label}
      <input className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function BeamFigure({
  span,
  lineLoad,
  reaction,
  solved,
}: {
  span: number | null;
  lineLoad: number | null;
  reaction: number | null;
  solved: boolean;
}) {
  return (
    <figure>
      <svg viewBox="0 0 640 210" className="h-48 w-full rounded border border-slate-200 bg-slate-50" role="img" aria-label="Simply supported beam with uniform load, span, and end reactions">
        <line className="stroke-red-800" x1="80" y1="40" x2="560" y2="40" strokeWidth="2" />
        {Array.from({ length: 13 }, (_, index) => (
          <g key={index}>
            <line className="stroke-red-600" x1={80 + index * 40} y1="40" x2={80 + index * 40} y2="78" strokeWidth="2" />
            <path className="stroke-red-600" d={`M${80 + index * 40 - 4} 72 l4 8 l4 -8`} fill="none" strokeWidth="2" />
          </g>
        ))}
        <line className="stroke-slate-900" x1="80" y1="96" x2="560" y2="96" strokeWidth="8" />
        <path className="stroke-blue-700" d="M80 104 l-16 22 h32 z" fill="none" strokeWidth="2" />
        <line className="stroke-blue-700" x1="64" y1="128" x2="96" y2="128" strokeWidth="2" />
        <circle className="stroke-blue-700" cx="560" cy="112" r="8" fill="none" strokeWidth="2" />
        <line className="stroke-blue-700" x1="544" y1="128" x2="576" y2="128" strokeWidth="2" />
        <path className="stroke-blue-900" d="M80 150 l0 22" strokeWidth="2" />
        <path className="stroke-blue-900" d="M74 164 l6 8 l6 -8" fill="none" strokeWidth="2" />
        <path className="stroke-blue-900" d="M560 150 l0 22" strokeWidth="2" />
        <path className="stroke-blue-900" d="M554 164 l6 8 l6 -8" fill="none" strokeWidth="2" />
        <line className="stroke-slate-700" x1="80" y1="188" x2="560" y2="188" strokeWidth="1" />
        <text className="fill-red-800" x="250" y="24" fontSize="14">
          q = {lineLoad == null ? "not calculated" : `${lineLoad.toFixed(0)} N/m`}
        </text>
        <text className="fill-slate-700" x="270" y="204" fontSize="14">
          L = {span == null ? "unknown" : `${span} m`}
        </text>
        <text className="fill-blue-900" x="8" y="168" fontSize="12">
          R = {reaction == null ? "—" : `${reaction.toFixed(0)} N`}
        </text>
        <text className="fill-blue-900" x="500" y="168" fontSize="12">
          R = {reaction == null ? "—" : `${reaction.toFixed(0)} N`}
        </text>
      </svg>
      <figcaption className="mt-1 text-xs text-slate-600">
        {solved
          ? "Support symbols, uniform load, span, and reactions. Shear, moment, and deflection diagrams below use the beam-element result."
          : "Physical diagram of the entered model. It is not a finite-element result until beam elements are run."}
      </figcaption>
    </figure>
  );
}

function ProfilePreview({ form, spanM }: { form: ScenarioForm; spanM: number | null }) {
  const depth = Number(form.depth_m ?? "") / 1000;
  const width = Number(form.flange_width_m ?? "") / 1000;
  const flange = Number(form.flange_thickness_m ?? "") / 1000;
  const web = Number(form.web_thickness_m ?? "") / 1000;
  const length = spanM && spanM > 0 ? spanM : 1;
  const webHeight = depth - 2 * flange;
  const ready = depth > 0 && width > web && flange > 0 && web > 0 && webHeight > 0;
  if (!ready) return <p className="mt-3 text-sm text-slate-600">Enter a valid I-section to preview the geometry. That preview is not a solved model.</p>;
  const shown = Math.min(length, Math.max(depth * 4, width * 4));
  const distance = Math.max(shown, width, depth) * 1.45;
  return (
    <div className="mt-3">
      <div className="relative h-56 rounded border border-slate-200">
        <Canvas camera={{ position: [distance, -distance, distance * 0.55], fov: 35 }}>
          <ambientLight intensity={0.85} />
          <directionalLight position={[1, -1, 2]} intensity={1.1} />
          <mesh position={[0, 0, -depth / 2 + flange / 2]}>
            <boxGeometry args={[shown, width, flange]} />
            <meshStandardMaterial color="#94a3b8" />
          </mesh>
          <mesh>
            <boxGeometry args={[shown, web, webHeight]} />
            <meshStandardMaterial color="#64748b" />
          </mesh>
          <mesh position={[0, 0, depth / 2 - flange / 2]}>
            <boxGeometry args={[shown, width, flange]} />
            <meshStandardMaterial color="#94a3b8" />
          </mesh>
          <OrbitControls makeDefault />
        </Canvas>
      </div>
      <p className="mt-2 text-sm text-slate-600">
        Geometry preview of the entered I-section. The picture is shortened when the span is long, so the flanges stay visible.
        Span {length} m. Not a finite-element result.
      </p>
    </div>
  );
}
