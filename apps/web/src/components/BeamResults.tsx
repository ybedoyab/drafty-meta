import type { BeamStation, ScenarioSession } from "@/lib/api";

export function BeamResults({
  session,
  busy,
  onRun,
  onCompare,
  onDownload,
}: {
  session: ScenarioSession;
  busy: boolean;
  onRun: () => void;
  onCompare: () => void;
  onDownload: () => void;
}) {
  const analysis = session.analysis;
  const canRun = !busy;
  return (
    <div className="space-y-4">
      <ul className="grid gap-2 text-sm sm:grid-cols-2">
        <li>Span {session.inputs.span_m ?? "missing"} m</li>
        <li>Line load {session.calculation ? `${session.calculation.q_line_n_per_m.toFixed(1)} N/m` : "not calculated"}</li>
        <li>Supports {session.inputs.supports || "not confirmed"}</li>
        <li>Material {session.beam?.material?.name ?? "not selected"}</li>
      </ul>
      <fieldset className="space-y-2 text-sm">
        <legend className="font-medium">Analysis method</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="beam-method" value="euler-bernoulli" checked onChange={() => undefined} />
          Euler-Bernoulli beam elements
        </label>
        <label className="flex items-center gap-2 text-slate-500">
          <input type="radio" name="beam-method" value="solid" disabled />
          3D solid CalculiX
        </label>
      </fieldset>
      <p className="text-sm leading-6">{session.model_proposal.reason}</p>
      <p className="text-sm">3D simulation is not available for this floor beam.</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!canRun}
          onClick={onRun}
        >
          Run beam elements
        </button>
        <button type="button" className="rounded-md bg-slate-200 px-3 py-2 text-sm text-slate-500" disabled>
          Run 3D simulation
        </button>
      </div>
      {analysis && (
        <div className="space-y-3">
          {analysis.stale && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
              These diagrams used the previous inputs. Run the beam elements again before treating them as current.
            </p>
          )}
          <h3 className="text-sm font-semibold">Beam-element results</h3>
          <p className="text-sm leading-6">
            {analysis.elements} Hermitian elements. Numerical check {analysis.passed ? "passed" : "failed"} against the
            closed form (deflection difference {(analysis.deflection_error * 100).toFixed(3)}%, moment difference{" "}
            {(analysis.moment_error * 100).toFixed(3)}%). Equilibrium residual {analysis.equilibrium.residual_n.toExponential(2)} N.
            This is not a certification.
          </p>
          <p className="break-words font-mono text-sm">
            Midspan {millimetres(analysis.midspan_deflection_m)} mm. Moment {analysis.max_moment_n_m.toFixed(1)} N·m.
            Elastic bending stress {megapascals(analysis.max_elastic_bending_stress_pa)} MPa. Reactions{" "}
            {analysis.left_reaction_n.toFixed(1)} N and {analysis.right_reaction_n.toFixed(1)} N, upward.
          </p>
          <p className="text-sm text-slate-600">
            Elastic range: {analysis.elastic_range}. Mesh {analysis.mesh.nodes} nodes, {analysis.mesh.elements}{" "}
            {analysis.mesh.element_type} elements. Solver {analysis.solver.name}.
          </p>
          <div className="grid gap-3 lg:grid-cols-3">
            <Chart stations={analysis.stations} field="shear_n" title="Shear force" unit="N" />
            <Chart stations={analysis.stations} field="moment_n_m" title="Bending moment" unit="N·m" />
            <Chart stations={analysis.stations} field="deflection_m" title="Deflection" unit="mm" scale={1000} />
          </div>
          {session.comparison && !analysis.stale && (
            <div className="overflow-x-auto">
            <table className="w-full min-w-[28rem] text-left text-sm">
              <caption className="mb-2 text-left font-medium">Confirmed run and edited run</caption>
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="py-1 pr-3 font-medium">Result</th>
                  <th className="py-1 pr-3 font-medium">Confirmed, {analysis.span_m} m</th>
                  <th className="py-1 font-medium">Edited, {session.comparison.span_m} m</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="py-1 pr-3">Midspan deflection</td>
                  <td className="py-1 pr-3">{millimetres(analysis.midspan_deflection_m)} mm</td>
                  <td className="py-1">{millimetres(session.comparison.midspan_deflection_m)} mm</td>
                </tr>
                <tr>
                  <td className="py-1 pr-3">Moment</td>
                  <td className="py-1 pr-3">{analysis.max_moment_n_m.toFixed(1)} N·m</td>
                  <td className="py-1">{session.comparison.max_moment_n_m.toFixed(1)} N·m</td>
                </tr>
                <tr>
                  <td className="py-1 pr-3">Elastic stress</td>
                  <td className="py-1 pr-3">{megapascals(analysis.max_elastic_bending_stress_pa)} MPa</td>
                  <td className="py-1">{megapascals(session.comparison.max_elastic_bending_stress_pa)} MPa</td>
                </tr>
              </tbody>
            </table>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm disabled:opacity-50"
              disabled={busy || analysis.stale}
              onClick={onCompare}
            >
              Compare this edit
            </button>
            <button
              type="button"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm disabled:opacity-50"
              disabled={busy || Boolean(analysis.stale)}
              onClick={onDownload}
            >
              Download report
            </button>
          </div>
          <ul className="list-disc space-y-1 pl-4 text-sm text-slate-700">
            {analysis.limitations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Chart({
  stations,
  field,
  title,
  unit,
  scale = 1,
}: {
  stations: BeamStation[];
  field: "shear_n" | "moment_n_m" | "deflection_m";
  title: string;
  unit: string;
  scale?: number;
}) {
  const width = 320;
  const height = 140;
  const values = stations.map((station) => station[field] * scale);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const points = stations
    .map((station, index) => {
      const x = 28 + (index / Math.max(stations.length - 1, 1)) * (width - 40);
      const y = 16 + ((max - station[field] * scale) / span) * (height - 36);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const zero = 16 + ((max - 0) / span) * (height - 36);
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-36 w-full rounded border border-slate-200 bg-slate-50"
      role="img"
      aria-label={`${title}, from ${min.toFixed(2)} to ${max.toFixed(2)} ${unit}`}
    >
      <text x="8" y="14" fontSize="12" fill="#334155">
        {title} ({unit})
      </text>
      <line x1="28" y1={zero} x2={width - 12} y2={zero} stroke="#cbd5e1" />
      <polyline fill="none" stroke="#1e293b" strokeWidth="2" points={points} />
    </svg>
  );
}

function millimetres(meters: number) {
  return (meters * 1000).toFixed(3);
}

function megapascals(pascals: number) {
  return (pascals / 1e6).toFixed(1);
}
