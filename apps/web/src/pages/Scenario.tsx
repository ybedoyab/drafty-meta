import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Link } from "react-router-dom";
import { useEffect, useState, type ReactNode } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import {
  createScenario,
  deleteScenarioEvidence,
  getScenario,
  scenarioEvidenceUrl,
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
  type ScenarioForm,
} from "@/lib/scenario";

export function Scenario() {
  const [session, setSession] = useState<ScenarioSession | null>(null);
  const [form, setForm] = useState<ScenarioForm>(emptyForm);
  const [draft, setDraft] = useState("");
  const [role, setRole] = useState("photo");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  async function submit(message: string, patch?: Partial<ScenarioForm>) {
    if (!session) return;
    const nextForm = { ...form, ...patch };
    setForm(nextForm);
    setBusy(true);
    setError(null);
    try {
      const next = await turnScenario(session.id, { message, inputs: inputsFromForm(nextForm) });
      setSession(next);
      setForm(formFromInputs(next.inputs));
      setDraft("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The turn failed.");
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

  const connected = session?.mode === "meta-responses";
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <SiteHeader />
      <main className="mx-auto grid max-w-6xl gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(300px,0.7fr)]">
        <section className="flex min-h-[70vh] flex-col rounded-lg border border-slate-200 bg-white">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                {connected ? `Muse ${session?.model ?? "Spark"} · Responses API` : "Guided template · AI not connected"}
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
          </form>
        </section>

        <div className="space-y-4">
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
          </Panel>
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
                  <button type="button" onClick={() => void removeImage(item.id)}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
        </div>

        <section className="space-y-4 lg:col-span-2">
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
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel title="Sources">
              <ul className="space-y-3 text-sm">
                {(session?.sources ?? []).map((item) => (
                  <li key={`${item.origin}-${item.title}`}>
                    <p className="font-medium">{item.title}</p>
                    <p className="text-slate-600">{item.status}. {item.limit}</p>
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
            <p className="text-sm leading-6">{session?.model_proposal.reason}</p>
            <p className="mt-2 text-sm">3D simulation is not available for this floor beam.</p>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-slate-700">
              {(session?.verification ?? []).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <button type="button" className="mt-3 rounded-md bg-slate-200 px-3 py-2 text-sm text-slate-500" disabled>
              Run 3D simulation
            </button>
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
        R = {reaction == null ? "—" : `${reaction.toFixed(0)} N`}
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
