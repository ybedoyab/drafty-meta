import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Link, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { BeamResults } from "@/components/BeamResults";
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
  downloadScenarioReport,
  getHealth,
  getScenario,
  scenarioEvidenceUrl,
  segmentScenario,
  turnScenario,
  uploadScenarioEvidence,
  type ScenarioSession,
} from "@/lib/api";
import {
  CLASSROOM_PROMPT,
  emptyForm,
  formFromInputs,
  inputsFromForm,
  recallScenarioId,
  rememberScenarioId,
  stageStudioSpec,
  type ScenarioForm,
} from "@/lib/scenario";

const PHASE_LABEL: Record<string, string> = {
  collecting: "Collecting the problem",
  asking: "Asking for missing data",
  "interpreting-evidence": "Reading attached images",
  searching: "Reviewing retrieved sources",
  "building-model": "Preliminary model ready",
  verifying: "Beam-element results ready",
};

const WORKFLOW = ["understand", "research", "model", "validate", "simulate", "optimize"] as const;

export function Scenario() {
  const [session, setSession] = useState<ScenarioSession | null>(null);
  const [form, setForm] = useState<ScenarioForm>(emptyForm);
  const [draft, setDraft] = useState("");
  const [role, setRole] = useState("photo");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metaReady, setMetaReady] = useState(false);
  const [segmentPrompt, setSegmentPrompt] = useState("bracket");
  const [supportFace, setSupportFace] = useState("");
  const [loadFace, setLoadFace] = useState("");
  const [linkedJobs, setLinkedJobs] = useState<Awaited<ReturnType<typeof getJob>>[]>([]);
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
        setForm(formFromInputs(next.inputs));
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

  async function submit(message: string, patch?: Partial<ScenarioForm>) {
    if (!session) return;
    const nextForm = { ...form, ...patch };
    setForm(nextForm);
    turnAbort.current?.abort();
    const controller = new AbortController();
    turnAbort.current = controller;
    setBusy(true);
    setError(null);
    try {
      const next = await turnScenario(session.id, { message, inputs: inputsFromForm(nextForm) }, controller.signal);
      if (controller.signal.aborted) return;
      setSession(next);
      setForm(formFromInputs(next.inputs));
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
        inputs: inputsFromForm(form),
      });
      setSession(next);
      if (!compare) setForm(formFromInputs(next.inputs));
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
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <SiteHeader />
      <main className="mx-auto grid min-w-0 max-w-6xl gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(300px,0.7fr)]">
        <section className="flex min-h-[70vh] min-w-0 flex-col rounded-lg border border-slate-200 bg-white">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                {PHASE_LABEL[session?.phase ?? "collecting"] ?? "Collecting the problem"}
                {connected
                  ? ` · ${session?.model ?? "muse-spark-1.3"} · Responses API`
                  : metaReady
                    ? " · Muse Spark ready"
                    : " · AI not connected"}
              </p>
              <h1 className="text-xl font-semibold">Scenario assistant</h1>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => void startFresh()} disabled={busy}>
                New scenario
              </Button>
              <Link to="/studio" className="inline-flex items-center text-sm font-medium text-slate-800 underline">
                Open Studio manually
              </Link>
            </div>
          </header>
          <ol className="flex flex-wrap gap-2 border-b border-slate-200 px-4 py-2 text-xs">
            {WORKFLOW.map((stage) => (
              <li
                key={stage}
                className={stage === workflow ? "rounded bg-slate-900 px-2 py-1 font-medium text-white" : "rounded bg-slate-100 px-2 py-1 text-slate-600"}
              >
                {stage}
              </li>
            ))}
          </ol>
          {session?.tool_trace?.[0] && (
            <div className="border-b border-slate-200 px-4 py-2 text-xs text-slate-700">
              <p>
                Tool {session.tool_trace[0].tool} · status {session.tool_trace[0].status}
                {session.tool_trace[0].authorization === "user_confirmation" ? " · approval required" : ""}
              </p>
              <p className="text-slate-600">{session.tool_trace[0].detail}</p>
              <p className="text-slate-500">
                Simulator: {session.engineering?.simulator ?? "none"}. A selected tool name is not a finished solve.
              </p>
            </div>
          )}
          <div className="flex-1 space-y-3 overflow-auto px-4 py-4">
            {(session?.messages ?? []).map((entry, index) => (
              <p key={`${entry.role}-${index}`} className="text-sm leading-6">
                <span className="font-semibold">{entry.role === "user" ? "You" : "Drafty"}: </span>
                {entry.text}
              </p>
            ))}
            {session && session.messages.length === 0 && (
              <p className="text-sm leading-6 text-slate-600">
                Describe the structure in your own words. Drafty will ask for what is missing and will not turn a floor
                beam into the cantilever solver.
              </p>
            )}
          </div>
          <form
            className="border-t border-slate-200 p-4"
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
              <Button type="submit" variant="primary" disabled={busy || !session || !draft.trim()}>
                Send
              </Button>
              <Button type="button" disabled={busy || !session} onClick={() => void submit(CLASSROOM_PROMPT)}>
                Use the classroom example
              </Button>
              <Button type="button" disabled={busy || !session} onClick={() => void submit("Review the current inputs.")}>
                Review inputs
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

        <div className="min-w-0 space-y-4">
          <Panel title="Still needed">
            {session?.missing.length ? (
              <ul className="list-disc space-y-1 pl-4 text-sm">
                {session.missing.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-600">The preliminary record has the inputs it knows how to use.</p>
            )}
            {questions.length > 0 && (
              <div className="mt-3">
                <ul className="list-disc space-y-1 pl-4 text-sm">
                  {questions.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <Button className="mt-3" type="button" disabled={busy} onClick={() => void dismiss()}>
                  Reject suggestion
                </Button>
              </div>
            )}
          </Panel>
          {domain !== "mechanical" && (
          <Panel title="Inputs">
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Jurisdiction" value={form.jurisdiction} onChange={(jurisdiction) => setForm({ ...form, jurisdiction })} />
              <Field label="Span m" value={form.spanM} onChange={(spanM) => setForm({ ...form, spanM })} />
              <Field label="Tributary width m" value={form.tributaryM} onChange={(tributaryM) => setForm({ ...form, tributaryM })} />
              <Field label="Dead load kN/m²" value={form.deadKn} onChange={(deadKn) => setForm({ ...form, deadKn })} />
              <Field label="Live load kN/m²" value={form.liveKn} onChange={(liveKn) => setForm({ ...form, liveKn })} />
              <Field label="Beam self-weight N/m" value={form.selfWeight} onChange={(selfWeight) => setForm({ ...form, selfWeight })} />
              <Field label="Depth mm" value={form.depthMm} onChange={(depthMm) => setForm({ ...form, depthMm })} />
              <Field label="Flange width mm" value={form.flangeWidthMm} onChange={(flangeWidthMm) => setForm({ ...form, flangeWidthMm })} />
              <Field label="Flange thickness mm" value={form.flangeThicknessMm} onChange={(flangeThicknessMm) => setForm({ ...form, flangeThicknessMm })} />
              <Field label="Web thickness mm" value={form.webThicknessMm} onChange={(webThicknessMm) => setForm({ ...form, webThicknessMm })} />
              <Field label="Supports" value={form.supports} onChange={(supports) => setForm({ ...form, supports })} />
            </div>
            <Button
              className="mt-3"
              type="button"
              disabled={busy || !session}
              onClick={() => void submit("Use the Colombia classroom minimum.", { jurisdiction: "Colombia" })}
            >
              Use Colombia NSR-10 classroom minimum
            </Button>
          </Panel>
          )}
          <Panel title="Evidence">
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
                  <rect x={object.left} y={object.top} width={Math.max(object.right - object.left, 1)} height={Math.max(object.bottom - object.top, 1)} fill="none" stroke="#4f46e5" />
                  {object.path && <path d={object.path} transform={`translate(${object.left} ${object.top})`} fill="rgba(79,70,229,0.25)" />}
                </svg>
              );
            })}
          </Panel>
        </div>

        <section className="min-w-0 space-y-4 lg:col-span-2">
          <Panel title="Load path">
            <BeamFigure
              span={session?.inputs.span_m ?? null}
              lineLoad={session?.calculation?.q_line_n_per_m ?? null}
              reaction={session?.beam?.end_shear_n ?? null}
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
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Assumptions">
              <ul className="space-y-2 text-sm">
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
          <Panel title="Simulation gate">
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
                onRun={() => void runBeam(false)}
                onCompare={() => void runBeam(true)}
                onDownload={() => void downloadReport()}
              />
            )}
            {domain === "unknown" && <p className="text-sm">No solver is selected yet.</p>}
            {!session && <p className="text-sm">The scenario is still loading.</p>}
            <ul className="mt-3 list-disc space-y-1 pl-4 text-sm text-slate-700">
              {(session?.verification ?? []).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </Panel>
        </section>
      </main>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
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

function BeamFigure({ span, lineLoad, reaction }: { span: number | null; lineLoad: number | null; reaction: number | null }) {
  return (
    <svg viewBox="0 0 640 180" className="h-40 w-full rounded border border-slate-200 bg-slate-50" role="img" aria-label="Simply supported beam with uniform load and end reactions">
      <line x1="80" y1="90" x2="560" y2="90" stroke="#0f172a" strokeWidth="6" />
      <path d="M80 90 l-14 18 h28 z" fill="none" stroke="#2563eb" strokeWidth="2" />
      <circle cx="560" cy="100" r="8" fill="none" stroke="#2563eb" strokeWidth="2" />
      {Array.from({ length: 12 }, (_, index) => (
        <line key={index} x1={110 + index * 36} y1="42" x2={110 + index * 36} y2="78" stroke="#dc2626" strokeWidth="2" />
      ))}
      <text x="80" y="150" fontSize="14" fill="#334155">
        L = {span == null ? "—" : `${span} m`}
      </text>
      <text x="250" y="28" fontSize="14" fill="#991b1b">
        q = {lineLoad == null ? "—" : `${lineLoad.toFixed(0)} N/m`}
      </text>
      <text x="430" y="150" fontSize="14" fill="#1e3a8a">
        R = {reaction == null ? "—" : `${reaction.toFixed(0)} N upward`}
      </text>
    </svg>
  );
}

function ProfilePreview({ form, spanM }: { form: ScenarioForm; spanM: number | null }) {
  const depth = Number(form.depthMm) / 1000;
  const width = Number(form.flangeWidthMm) / 1000;
  const flange = Number(form.flangeThicknessMm) / 1000;
  const web = Number(form.webThicknessMm) / 1000;
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
