import { Eraser, PenLine, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { SURFACES, type DesignForm, type Surface } from "@/lib/design";
import {
  beautifyCandidates,
  classifySketch,
  closeSketchWithAspect,
  proposeSketchSize,
  snapProfileToGrid,
  type RawPoint,
  type SketchAdditionForm,
  type SketchShapeKind,
} from "@/lib/sketch";

const FACE_LABELS: Record<Surface, string> = {
  zmax: "Top (zmax)",
  zmin: "Bottom (zmin)",
  xmax: "End (xmax)",
  xmin: "Start (xmin)",
  ymax: "Front (ymax)",
  ymin: "Back (ymin)",
};

export function DrawTool({
  form,
  hasPart,
  gridStepMm = 0,
  onClose,
  onDraft,
}: {
  form: DesignForm;
  hasPart: boolean;
  gridStepMm?: number;
  onClose: () => void;
  onDraft: (addition: SketchAdditionForm, standalone: boolean) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const [raw, setRaw] = useState<RawPoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [standalone, setStandalone] = useState(!hasPart);
  const [face, setFace] = useState<Surface>("zmax");
  const [label, setLabel] = useState("");
  const [size, setSize] = useState<{ widthMm: number; heightMm: number; depthMm: number } | null>(null);
  const [finished, setFinished] = useState(false);
  const [tidySketch, setTidySketch] = useState(true);
  const [picked, setPicked] = useState<SketchShapeKind | null>(null);
  const closed = raw.length >= 3 ? closeSketchWithAspect(raw) : null;
  const candidates = raw.length >= 3 ? beautifyCandidates(raw) : [];
  const beautified = candidates[0] ?? null;
  // The flag only picks which outline is proposed; the literal stroke is kept.
  const cleaned = tidySketch ? (candidates.find((fit) => fit.kind === picked) ?? beautified) : null;
  const closeCall = candidates.filter(
    (fit) => candidates.length > 1 && fit.confidence >= candidates[0].confidence - 0.15,
  );
  const proposal =
    finished && closed
      ? { profile: cleaned?.profile ?? closed.profile, aspect: closed.aspect }
      : null;
  const blockedFace = !standalone && (face === form.support || face === form.loadSurface);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#cbd5e1";
    context.lineWidth = 1;
    for (let x = 0; x <= canvas.width; x += 24) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, canvas.height);
      context.stroke();
    }
    for (let y = 0; y <= canvas.height; y += 24) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(canvas.width, y);
      context.stroke();
    }
    if (raw.length) {
      context.strokeStyle = "#1d4ed8";
      context.lineWidth = 3;
      context.lineJoin = "round";
      context.lineCap = "round";
      context.beginPath();
      context.moveTo(raw[0].x, raw[0].y);
      for (const point of raw.slice(1)) context.lineTo(point.x, point.y);
      if (closed) context.closePath();
      context.stroke();
      if (closed) {
        context.fillStyle = "rgba(37, 99, 235, 0.10)";
        context.fill();
      }
    }
    if (cleaned && raw.length) {
      const xs = raw.map((point) => point.x);
      const ys = raw.map((point) => point.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const spanX = Math.max(...xs) - minX;
      const spanY = Math.max(...ys) - minY;
      context.strokeStyle = "#059669";
      context.lineWidth = 2.5;
      context.setLineDash([6, 4]);
      context.beginPath();
      cleaned.profile.forEach((point, index) => {
        const x = minX + point.u * spanX;
        const y = minY + (1 - point.v) * spanY;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.closePath();
      context.stroke();
      context.setLineDash([]);
    }
  }, [raw, closed, finished, cleaned]);

  useEffect(() => {
    if (!proposal) return;
    setLabel((current) => current || (cleaned ? cleaned.label : classifySketch(proposal.profile)));
    setSize((current) => {
      if (current) return current;
      const proposed = proposeSketchSize(proposal.aspect, standalone ? null : form, face, standalone);
      if (!cleaned || gridStepMm <= 0) return proposed;
      // A cleaned shape starts life on the studio grid.
      const snapMm = (value: number) => Math.max(gridStepMm, Math.round(value / gridStepMm) * gridStepMm);
      return { widthMm: snapMm(proposed.widthMm), heightMm: snapMm(proposed.heightMm), depthMm: snapMm(proposed.depthMm) };
    });
    // A new outline earns a fresh proposal; size edits after that are kept.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposal?.profile]);

  function pointFromEvent(event: React.PointerEvent<HTMLCanvasElement>): RawPoint {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * event.currentTarget.width,
      y: ((event.clientY - rect.top) / rect.height) * event.currentTarget.height,
    };
  }

  function startDraft() {
    if (!proposal || !size) {
      setError("Draw one closed outline first. It closes automatically back to where you started.");
      return;
    }
    if (blockedFace) {
      setError("That face is the support or load face. Pick another face, or change the held and loaded faces in Loads.");
      return;
    }
    if ([size.widthMm, size.heightMm, size.depthMm].some((value) => !Number.isFinite(value) || value <= 0)) {
      setError("Width, height, and depth must be positive numbers.");
      return;
    }
    onDraft(
      {
        id: `sketch-${Date.now()}`,
        label: label.trim() || cleaned?.label || classifySketch(proposal.profile),
        face: standalone ? "zmax" : face,
        shape: cleaned?.kind === "ellipse" ? "ellipse" : "polygon",
        profile:
          cleaned && cleaned.kind !== "ellipse"
            ? snapProfileToGrid(proposal.profile, size.widthMm, size.heightMm, gridStepMm)
            : proposal.profile,
        widthMm: size.widthMm,
        heightMm: size.heightMm,
        depthMm: size.depthMm,
        offsetUMm: 0,
        offsetWMm: 0,
      },
      standalone,
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-label="Draw a piece to add">
      <div className="grid max-h-full w-full max-w-4xl grid-cols-[minmax(0,1fr)_280px] overflow-auto rounded-xl bg-white shadow-xl">
        <div className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Draw a piece to add</h2>
              <p className="mt-1 text-sm text-gray-600">One closed outline, extruded as a solid piece.</p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close the draw tool" className="rounded-md p-1 text-gray-500 hover:bg-slate-100">
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>
          <canvas
            ref={canvasRef}
            width={640}
            height={420}
            data-testid="sketch-canvas"
            className="mt-3 w-full touch-none rounded-lg border border-slate-300 bg-white"
            onPointerDown={(event) => {
              const point = pointFromEvent(event);
              event.currentTarget.setPointerCapture(event.pointerId);
              drawing.current = true;
              setFinished(false);
              setRaw([point]);
              setSize(null);
              setLabel("");
              setPicked(null);
              setError(null);
            }}
            onPointerMove={(event) => {
              if (!drawing.current) return;
              const point = pointFromEvent(event);
              setRaw((current) => [...current, point]);
            }}
            onPointerUp={() => {
              drawing.current = false;
              setFinished(true);
            }}
            onPointerCancel={() => {
              drawing.current = false;
            }}
          />
          <div className="mt-2 flex items-center gap-2">
            <Button
              type="button"
              onClick={() => {
                setFinished(false);
                setRaw([]);
                setSize(null);
                setLabel("");
                setPicked(null);
                setError(null);
              }}
            >
              <Eraser className="mr-1 h-4 w-4" aria-hidden /> Clear
            </Button>
            <p className="text-xs text-gray-500" aria-live="polite">
              {proposal
                ? cleaned
                  ? `${cleaned.label} · ${proposal.profile.length} points`
                  : `${proposal.profile.length} points, as drawn`
                : cleaned
                  ? `${cleaned.label} · lift to use it`
                  : beautified && !tidySketch
                    ? `Reads as a ${beautified.label.toLowerCase()} · as drawn`
                    : "Draw one closed outline"}
            </p>
          </div>
          {error && <p className="mt-2 text-sm text-amber-700">{error}</p>}
        </div>
        <div className="border-l border-gray-200 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Proposal</p>
            {cleaned ? (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                {cleaned.label} · {Math.round(cleaned.confidence * 100)}%
              </span>
            ) : proposal ? (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">As drawn</span>
            ) : null}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1" role="group" aria-label="Outline mode">
            {(
              [
                [true, "Clean shape"],
                [false, "As drawn"],
              ] as const
            ).map(([value, text]) => (
              <button
                key={text}
                type="button"
                aria-pressed={tidySketch === value}
                title={value ? "Use the cleaned, completed shape" : "Use exactly the outline you drew"}
                onClick={() => {
                  setTidySketch(value);
                  // Let the label be re-proposed for the outline now in effect.
                  setLabel("");
                }}
                className={
                  tidySketch === value
                    ? "rounded-md bg-white px-2 py-1.5 text-xs font-medium text-slate-900 shadow-sm"
                    : "rounded-md px-2 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-700"
                }
              >
                {text}
              </button>
            ))}
          </div>
          {!tidySketch && beautified && (
            <p className="mt-1.5 text-xs text-slate-500">Reads as a {beautified.label.toLowerCase()}.</p>
          )}
          {finished && tidySketch && closeCall.length > 1 && (
            <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label="Shape choices">
              {closeCall.map((fit) => (
                <button
                  key={fit.kind}
                  type="button"
                  aria-pressed={cleaned?.kind === fit.kind}
                  onClick={() => {
                    setPicked(fit.kind);
                    setLabel("");
                  }}
                  className={
                    cleaned?.kind === fit.kind
                      ? "rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-white"
                      : "rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                  }
                >
                  {fit.label} · {Math.round(fit.confidence * 100)}%
                </button>
              ))}
            </div>
          )}
          <label className="field mt-3">
            <span>Intention</span>
            <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Roof, rib, boss…" />
          </label>
          <label className="mt-3 flex items-start gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={standalone}
              onChange={(event) => {
                setStandalone(event.target.checked);
                setSize(null);
              }}
            />
            <span>Sketch only, no base part</span>
          </label>
          {!standalone && (
            <label className="field mt-3">
              <span>Add on face</span>
              <select
                value={face}
                onChange={(event) => {
                  setFace(event.target.value as Surface);
                  setSize(null);
                }}
              >
                {SURFACES.map((surface) => (
                  <option key={surface} value={surface}>
                    {FACE_LABELS[surface]}
                  </option>
                ))}
              </select>
            </label>
          )}
          {blockedFace && (
            <p className="mt-2 text-xs leading-4 text-amber-700">
              {FACE_LABELS[face]} is the {face === form.support ? "support" : "load"} face. Pick another face.
            </p>
          )}
          <div className="mt-3 grid grid-cols-3 gap-2">
            <SizeField label="Width mm" value={size?.widthMm} onChange={(widthMm) => setSize((current) => ({ widthMm, heightMm: current?.heightMm ?? 0, depthMm: current?.depthMm ?? 0 }))} />
            <SizeField label="Height mm" value={size?.heightMm} onChange={(heightMm) => setSize((current) => ({ widthMm: current?.widthMm ?? 0, heightMm, depthMm: current?.depthMm ?? 0 }))} />
            <SizeField label="Depth mm" value={size?.depthMm} onChange={(depthMm) => setSize((current) => ({ widthMm: current?.widthMm ?? 0, heightMm: current?.heightMm ?? 0, depthMm }))} />
          </div>
          <Button type="button" variant="primary" className="mt-4 w-full" disabled={!proposal} onClick={startDraft}>
            <PenLine className="mr-1 h-4 w-4" aria-hidden /> Place this piece
          </Button>
          <p className="mt-2 text-xs text-gray-500">Then drag it into place in the viewport.</p>
        </div>
      </div>
    </div>
  );
}

function SizeField({ label, value, onChange }: { label: string; value: number | undefined; onChange: (value: number) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" value={value ?? ""} placeholder="—" onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}
