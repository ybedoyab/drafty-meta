import { useQuery } from "@tanstack/react-query";
import { CircleCheck, CircleX } from "lucide-react";
import { Link } from "react-router-dom";
import { SiteHeader } from "@/components/SiteHeader";
import { getMaterials, getParts } from "@/lib/api";
import { ANALYSIS_LABEL, type PartSummary } from "@/lib/scenario";

interface Item {
  title: string;
  detail: string;
}

// Parts and materials come from the server registry. These two lists describe the methods around them,
// and follow the README and docs/SCENARIO_UX_ARCHITECTURE.md.
const CAN: Item[] = [
  {
    title: "Talk through a problem",
    detail:
      "The chat asks for missing data and searches the web. Retrieved pages stay separate from the checked NSR-10 reference. Without a Meta key, a guided template asks the same questions.",
  },
  {
    title: "Load a classroom floor beam",
    detail:
      "Line load from dead plus live load times the tributary width. The NSR-10 Title B Table B.4.2.1-1 classroom minimum, 2.0 kN/m², is applied once Colombia is confirmed.",
  },
  {
    title: "Solve beams with beam elements",
    detail:
      "Euler-Bernoulli elements for a simple span, accepted only within 1% of the closed form on midspan deflection and moment, with balanced reactions.",
  },
  {
    title: "Run 3D solid FEM in Studio",
    detail:
      "CadQuery solid, Gmsh mesh with linear or quadratic tetrahedra, and CalculiX. Displacement, von Mises stress, an exploratory factor of safety, and a force balance.",
  },
  {
    title: "Benchmark the cantilever",
    detail: "Tip deflection within 8% and midspan stress within 20% of beam theory.",
  },
  {
    title: "Study one thickness",
    detail: "Up to six more real solves. The lightest thickness that meets the factor and displacement limit is marked. It is not a global optimum.",
  },
  {
    title: "Export the files",
    detail: "STEP, STL for the pawn, GLB, VTU, the CalculiX input and result files, and JSON and PDF reports.",
  },
  {
    title: "Keep evidence and voice",
    detail: "Up to eight PNG, JPEG, or WebP images per scenario as context, voice input, and spoken replies in English or Spanish.",
  },
  {
    title: "Save your work",
    detail: "Scenarios and jobs are saved per user. Projects can be reopened, renamed, and deleted.",
  },
];

const CANNOT: Item[] = [
  {
    title: "Certify a design",
    detail: "No result is a code check or an approval. Structural safety stays with the responsible engineer.",
  },
  {
    title: "Check strength",
    detail: "Bending and shear capacity, lateral-torsional and local buckling, connections, bearing, and vibration are not checked.",
  },
  {
    title: "Apply load combinations",
    detail: "Loads are service loads. No ultimate or code combination is built.",
  },
  {
    title: "Check deflection limits",
    detail: "Deflection is reported, but no serviceability limit such as L/360 is applied.",
  },
  {
    title: "Go beyond linear elastic",
    detail: "No plasticity or large deflection. A stress above yield only produces a warning.",
  },
  {
    title: "Add shear deformation to beam elements",
    detail: "Beam elements are Euler-Bernoulli. Timoshenko shear deformation is not included.",
  },
  {
    title: "Send a floor beam to the 3D solver",
    detail: "CalculiX takes one fixed face and one load face. A line-loaded, simply supported beam is not that model.",
  },
  {
    title: "Use several supports or load cases",
    detail: "Studio takes one fully fixed face and one force or pressure. Pins, rollers, and load cases are not available.",
  },
  {
    title: "Pick real faces",
    detail: "Supports and loads go on one of six bounding-box faces, xmin to zmax, not on a face you click.",
  },
  {
    title: "Measure from images",
    detail: "A picture is evidence. It never becomes a dimension.",
  },
  {
    title: "Model any other part",
    detail: "Only the parts listed below. A request such as a coffee mug is refused, and nothing is created.",
  },
];

export function Capabilities() {
  const parts = useQuery({ queryKey: ["parts"], queryFn: getParts });
  const materials = useQuery({ queryKey: ["materials"], queryFn: getMaterials });
  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 space-y-10 px-4 py-10 sm:px-6">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.16em] text-slate-500">Capabilities</p>
          <h1 className="mt-3 text-3xl font-semibold leading-tight text-slate-950 sm:text-4xl">What Drafty can and cannot do</h1>
          <p className="mt-4 max-w-2xl text-lg leading-7 text-slate-600">
            Drafty is a preliminary engineering assistant. It runs real calculations on a short list of parts, and says
            plainly where it stops.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/scenario/new" className="rounded-md bg-slate-950 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800">
              Start with AI
            </Link>
            <Link
              to="/studio"
              className="rounded-md border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-100"
            >
              Open Studio
            </Link>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <CapabilityList heading="Drafty can" items={CAN} positive />
          <CapabilityList heading="Drafty cannot" items={CANNOT} positive={false} />
        </div>

        <section aria-labelledby="parts-heading">
          <h2 id="parts-heading" className="text-xl font-semibold text-slate-950">
            Parts
          </h2>
          <p className="mt-1 text-sm text-slate-600">From the server's part registry. Anything not listed here is not supported yet.</p>
          {parts.isLoading && <p className="mt-4 text-sm text-slate-500">Loading the part registry…</p>}
          {parts.error && (
            <p className="mt-4 text-sm text-rose-700">
              The part registry is not available. {parts.error instanceof Error ? parts.error.message : ""}
            </p>
          )}
          {parts.data && (
            <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {parts.data.map((part) => (
                <PartCard key={part.id} part={part} />
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="materials-heading">
          <h2 id="materials-heading" className="text-xl font-semibold text-slate-950">
            Materials
          </h2>
          <p className="mt-1 text-sm text-slate-600">Typical published room-temperature values. They are not a certificate for a specific lot.</p>
          {materials.error && <p className="mt-4 text-sm text-rose-700">The material list is not available.</p>}
          {materials.data && (
            <ul className="mt-4 flex flex-wrap gap-2">
              {materials.data.map((material) => (
                <li key={material.id} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
                  <span className="font-medium text-slate-950">{material.name}</span>
                  <span className="block text-xs text-slate-500">
                    E {(material.youngs_modulus_pa / 1e9).toFixed(1)} GPa · yield {(material.yield_strength_pa / 1e6).toFixed(0)} MPa
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
      <footer className="border-t border-slate-200 px-6 py-4 text-sm text-slate-500">
        A completed study is not a certified design. Structural safety stays with the responsible engineer.
      </footer>
    </div>
  );
}

function CapabilityList({ heading, items, positive }: { heading: string; items: Item[]; positive: boolean }) {
  const Icon = positive ? CircleCheck : CircleX;
  return (
    <section className={`rounded-lg border bg-white p-5 ${positive ? "border-emerald-200" : "border-rose-200"}`}>
      <h2 className={`flex items-center gap-2 text-lg font-semibold ${positive ? "text-emerald-800" : "text-rose-800"}`}>
        <Icon className="h-5 w-5" aria-hidden />
        {heading}
      </h2>
      <ul className="mt-4 space-y-3">
        {items.map((item) => (
          <li key={item.title} className="flex gap-3">
            <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${positive ? "text-emerald-600" : "text-rose-600"}`} aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-950">{item.title}</p>
              <p className="text-sm leading-6 text-slate-600">{item.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PartCard({ part }: { part: PartSummary }) {
  return (
    <li className="flex flex-col rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold capitalize text-slate-950">{part.name}</h3>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
            part.where === "scenario" ? "bg-indigo-50 text-indigo-700" : "bg-slate-100 text-slate-700"
          }`}
        >
          {part.studio_kind ? "Chat → Studio" : part.where === "scenario" ? "Chat" : "Studio"}
        </span>
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-600">{part.description}</p>
      <div className="mt-3 flex flex-wrap gap-1">
        {part.analysis.map((item) => (
          <span key={item} className="rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">
            {ANALYSIS_LABEL[item] ?? item}
          </span>
        ))}
        {part.exports.map((item) => (
          <span key={item} className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
            {item}
          </span>
        ))}
      </div>
      {(part.methods ?? []).length > 0 && (
        <ul className="mt-3 space-y-1">
          {part.methods.map((item) => (
            <li key={item} className="flex gap-2 text-xs text-slate-700">
              <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />
              {item}
            </li>
          ))}
        </ul>
      )}
      {(part.limits ?? []).length > 0 && (
        <ul className="mt-2 space-y-1">
          {part.limits.map((item) => (
            <li key={item} className="flex gap-2 text-xs text-slate-700">
              <CircleX className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-600" aria-hidden />
              Not for this part: {item}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
