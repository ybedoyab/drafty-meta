import { Link } from "react-router-dom";
import { useMemo, useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import {
  NSR10_CLASSROOM,
  classroomLineLoad,
  loadDraft,
  saveDraft,
  type ScenarioDraft,
} from "@/lib/scenario";

const STAGES = ["Describe", "Evidence", "Clarify", "Research", "Model", "Brief"] as const;

export function Scenario() {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<ScenarioDraft>(() => loadDraft());
  const [error, setError] = useState<string | null>(null);

  function update(patch: Partial<ScenarioDraft>) {
    setDraft((current) => {
      const next = { ...current, ...patch };
      saveDraft(next);
      return next;
    });
  }

  const calculation = useMemo(() => {
    const dead = Number(draft.deadKPa) * 1000;
    const width = draft.tributaryM.trim() === "" ? null : Number(draft.tributaryM);
    const selfWeight = Number(draft.selfWeightNPerM || "0");
    if (draft.template !== "classroom-beam") return { error: "This path has no checked template yet." };
    try {
      if (width == null) return { error: "Tributary width is still missing, so no line load is calculated." };
      return { value: classroomLineLoad(dead, width, selfWeight) };
    } catch (reason) {
      return { error: reason instanceof Error ? reason.message : "The load could not be calculated." };
    }
  }, [draft]);

  function addFiles(files: FileList | null) {
    if (!files) return;
    const next = [...draft.evidence];
    for (const file of Array.from(files).slice(0, 8 - next.length)) {
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
        setError("Evidence images must be PNG, JPEG, or WebP. They are not measured.");
        continue;
      }
      if (file.size > 8 * 1024 * 1024) {
        setError("Each image is limited to 8 MB.");
        continue;
      }
      next.push({ id: crypto.randomUUID(), name: file.name, role: "context" });
    }
    update({ evidence: next });
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <SiteHeader />
      <main className="mx-auto grid max-w-5xl gap-6 px-4 py-6 lg:grid-cols-[180px_minmax(0,1fr)] lg:px-6">
        <ol className="flex gap-3 overflow-x-auto text-sm lg:block lg:space-y-2">
          {STAGES.map((name, index) => (
            <li key={name}>
              <button
                type="button"
                className={index === step ? "font-semibold text-slate-950" : "text-slate-500"}
                onClick={() => setStep(index)}
              >
                {index + 1}. {name}
              </button>
            </li>
          ))}
        </ol>
        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">Guided template · AI not connected</p>
            <Link to="/studio" className="text-sm font-medium text-slate-800 underline">
              Open Studio manually
            </Link>
          </div>
          {step === 0 && (
            <div className="mt-4 space-y-4">
              <h1 className="text-2xl font-semibold">What are you trying to understand?</h1>
              <textarea
                className="min-h-28 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={draft.goal}
                placeholder="A classroom floor carried by steel beams."
                onChange={(event) => update({ goal: event.target.value })}
              />
              <label className="block text-sm">
                Jurisdiction, entered by you
                <input
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                  value={draft.jurisdiction}
                  onChange={(event) => update({ jurisdiction: event.target.value })}
                />
              </label>
              <Button
                type="button"
                variant="primary"
                onClick={() =>
                  update({
                    template: "classroom-beam",
                    domain: "structural",
                    goal: draft.goal || "Preliminary study of a classroom floor on a steel I-beam.",
                    jurisdiction: draft.jurisdiction || "Colombia",
                  })
                }
              >
                Use the classroom beam template
              </Button>
            </div>
          )}
          {step === 1 && (
            <div className="mt-4 space-y-4">
              <h1 className="text-2xl font-semibold">Add evidence</h1>
              <p className="text-sm text-slate-600">Drawings and photos stay as context. Drafty does not measure them.</p>
              <input
                aria-label="Evidence images"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                onChange={(event) => addFiles(event.target.files)}
              />
              <ul className="space-y-2 text-sm">
                {draft.evidence.map((item) => (
                  <li key={item.id} className="flex items-center justify-between rounded border border-slate-200 px-3 py-2">
                    <span>{item.name}</span>
                    <button type="button" onClick={() => update({ evidence: draft.evidence.filter((entry) => entry.id !== item.id) })}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {step === 2 && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <h1 className="sm:col-span-2 text-2xl font-semibold">What is already known?</h1>
              <Field label="Span m" value={draft.spanM} onChange={(spanM) => update({ spanM })} />
              <Field label="Tributary width m" value={draft.tributaryM} onChange={(tributaryM) => update({ tributaryM })} />
              <Field label="Dead load kN/m²" value={draft.deadKPa} onChange={(deadKPa) => update({ deadKPa })} />
              <Field label="Beam self-weight N/m" value={draft.selfWeightNPerM} onChange={(selfWeightNPerM) => update({ selfWeightNPerM })} />
              <p className="sm:col-span-2 text-sm text-slate-600">
                Student count is not a load. The tributary width says how much of the floor reaches this beam.
              </p>
            </div>
          )}
          {step === 3 && (
            <article className="mt-4">
              <h1 className="text-2xl font-semibold">Checked reference</h1>
              <p className="mt-3 text-sm text-slate-600">No web search ran. This card is the template citation, not a model claim.</p>
              <dl className="mt-4 space-y-2 text-sm">
                <div><dt className="text-slate-500">Title</dt><dd>{NSR10_CLASSROOM.title}</dd></div>
                <div><dt className="text-slate-500">Section</dt><dd>{NSR10_CLASSROOM.section}</dd></div>
                <div><dt className="text-slate-500">Value</dt><dd>{NSR10_CLASSROOM.value}</dd></div>
                <div><dt className="text-slate-500">Status</dt><dd>{NSR10_CLASSROOM.status}</dd></div>
                <div>
                  <dt className="text-slate-500">Source</dt>
                  <dd><a className="underline" href={NSR10_CLASSROOM.url}>{NSR10_CLASSROOM.url}</a></dd>
                </div>
              </dl>
              <p className="mt-4 text-sm text-amber-800">{NSR10_CLASSROOM.limit}</p>
            </article>
          )}
          {step === 4 && (
            <div className="mt-4">
              <h1 className="text-2xl font-semibold">Load path</h1>
              <BeamDiagram />
              {"value" in calculation && calculation.value ? (
                <p className="mt-4 font-mono text-sm">
                  {calculation.value.formula} = {calculation.value.qLineNPerM.toFixed(1)} N/m. Live load{" "}
                  {calculation.value.liveNPerM2} N/m² is {calculation.value.liveStatus}.
                </p>
              ) : (
                <p className="mt-4 text-sm text-amber-800">{"error" in calculation ? calculation.error : ""}</p>
              )}
            </div>
          )}
          {step === 5 && (
            <div className="mt-4 space-y-3">
              <h1 className="text-2xl font-semibold">Scenario brief</h1>
              <p className="text-sm leading-6 text-slate-700">
                This is a preliminary educational study. It does not check bending or shear strength, lateral-torsional
                buckling, connections, bearing, vibration, or a code combination. It is not a safe or approved design.
              </p>
              <p className="text-sm text-slate-700">
                3D simulation is not available for this floor beam. The solid solver represents one face load on one
                supported solid, not a uniform load on a simply supported I-beam.
              </p>
              <Link to="/studio" className="inline-block text-sm font-medium underline">
                Open Studio manually for a supported solid
              </Link>
            </div>
          )}
          {error && <p className="mt-4 text-sm text-amber-800">{error}</p>}
          <div className="mt-8 flex gap-2">
            <Button type="button" onClick={() => setStep((value) => Math.max(0, value - 1))} disabled={step === 0}>
              Back
            </Button>
            <Button type="button" variant="primary" onClick={() => setStep((value) => Math.min(STAGES.length - 1, value + 1))} disabled={step === STAGES.length - 1}>
              Continue
            </Button>
          </div>
        </section>
      </main>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="text-sm">
      {label}
      <input className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function BeamDiagram() {
  return (
    <svg viewBox="0 0 360 120" className="mt-4 h-32 w-full rounded border border-slate-200 bg-slate-50" role="img" aria-label="Simply supported beam with a uniform load">
      <line x1="40" y1="70" x2="320" y2="70" stroke="#0f172a" strokeWidth="4" />
      <path d="M40 70 l-12 16 h24 z" fill="none" stroke="#2563eb" />
      <circle cx="320" cy="78" r="6" fill="none" stroke="#2563eb" />
      {Array.from({ length: 8 }, (_, index) => (
        <line key={index} x1={60 + index * 32} y1="28" x2={60 + index * 32} y2="58" stroke="#dc2626" />
      ))}
      <text x="40" y="104" fontSize="11" fill="#334155">Fixed is not assumed. Circles and triangles here are simple supports.</text>
    </svg>
  );
}
