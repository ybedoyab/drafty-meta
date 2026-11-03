import type { DesignForm, Surface } from "./design";

/**
 * Hand-sketched additions: a closed 2D profile, extruded and fused onto a face.
 * Profile points are normalized to the sketch bounding box: u across the face,
 * v rising outward from it (0 sits on the face). Sizes are millimetres here;
 * the API spec converts them to metres.
 */

export interface SketchPoint {
  u: number;
  v: number;
}

export interface SketchAdditionForm {
  id: string;
  label: string;
  face: Surface;
  profile: SketchPoint[];
  widthMm: number;
  heightMm: number;
  depthMm: number;
  offsetUMm: number;
  offsetWMm: number;
}

export interface RawPoint {
  x: number;
  y: number;
}

/** Face frame: profile-u axis, outward axis, extrusion axis, outward sign. Mirrors the API spec. */
export const FACE_FRAME: Record<Surface, { u: number; v: number; w: number; sign: 1 | -1 }> = {
  zmax: { u: 0, v: 2, w: 1, sign: 1 },
  zmin: { u: 0, v: 2, w: 1, sign: -1 },
  xmax: { u: 1, v: 0, w: 2, sign: 1 },
  xmin: { u: 1, v: 0, w: 2, sign: -1 },
  ymax: { u: 0, v: 1, w: 2, sign: 1 },
  ymin: { u: 0, v: 1, w: 2, sign: -1 },
};

const MAX_PROFILE_POINTS = 48;

/**
 * Turn one freehand stroke (canvas pixels, y down) into a closed, simplified,
 * normalized profile. The stroke is auto-closed back to its start; its
 * bounding box becomes the unit square, with v flipped so up is up.
 */
export function closeSketch(raw: RawPoint[]): SketchPoint[] | null {
  const cleaned: RawPoint[] = [];
  for (const point of raw) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    const last = cleaned[cleaned.length - 1];
    if (!last || Math.hypot(point.x - last.x, point.y - last.y) > 2) cleaned.push(point);
  }
  if (cleaned.length < 3) return null;
  const simplified = simplify(cleaned, 2.5);
  const points = downsample(simplified, MAX_PROFILE_POINTS);
  if (points.length < 3) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(...xs) - minX;
  const spanY = Math.max(...ys) - minY;
  if (spanX < 8 || spanY < 8) return null;
  return points.map((point) => ({
    u: round4((point.x - minX) / spanX),
    v: round4(1 - (point.y - minY) / spanY),
  }));
}

export function closeSketchWithAspect(raw: RawPoint[]): { profile: SketchPoint[]; aspect: number } | null {
  const profile = closeSketch(raw);
  if (!profile) return null;
  const xs = raw.map((point) => point.x);
  const ys = raw.map((point) => point.y);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  return { profile, aspect: spanX > 0 ? spanY / spanX : 1 };
}

/**
 * Local intention proposal from the outline alone. No AI call: corner count,
 * apex position, and curvature name the usual suspects; anything else stays
 * an honest custom prism. The label is editable before the piece is added.
 */
export function classifySketch(profile: SketchPoint[]): string {
  const corners = dominantCorners(profile);
  const top = Math.max(...profile.map((point) => point.v));
  const apex = profile.find((point) => point.v === top);
  const centredApex = apex !== undefined && apex.u > 0.3 && apex.u < 0.7;
  const bottomPoints = profile.filter((point) => point.v < 0.05).length;
  if (corners === 3 && centredApex) return "Roof";
  if (corners === 3) return "Wedge";
  if (corners === 4) {
    const ys = profile.map((point) => point.v);
    const topWidth = spanAt(profile, Math.max(...ys) - 0.02);
    const bottomWidth = spanAt(profile, 0.02);
    if (bottomWidth > 0 && topWidth / bottomWidth < 0.75) return "Trapezoid block";
    return "Block";
  }
  if (corners >= 7) return "Rounded boss";
  if (corners >= 5 && bottomPoints >= 1) return "Arch";
  return "Custom piece";
}

/** Bounding box of the base part in metres, in CAD coordinates. Mirrors the API envelope. */
export function partEnvelopeM(form: DesignForm): [number, number, number, number, number, number] {
  if (form.kind === "cantilever_beam") {
    return [0, form.lengthMm / 1000, -form.widthMm / 2000, form.widthMm / 2000, -form.heightMm / 2000, form.heightMm / 2000];
  }
  if (form.kind === "l_bracket") {
    return [0, form.legXMm / 1000, -form.widthMm / 2000, form.widthMm / 2000, 0, form.legZMm / 1000];
  }
  if (form.kind === "sketch_prism") {
    const addition = form.additions[0];
    if (!addition) return [0, 0, 0, 0, 0, 0];
    return [
      -addition.widthMm / 2000 + addition.offsetUMm / 1000,
      addition.widthMm / 2000 + addition.offsetUMm / 1000,
      -addition.depthMm / 2000 + addition.offsetWMm / 1000,
      addition.depthMm / 2000 + addition.offsetWMm / 1000,
      0,
      addition.heightMm / 1000,
    ];
  }
  return [0, form.lengthMm / 1000, -form.widthMm / 2000, form.widthMm / 2000, 0, form.thicknessMm / 1000];
}

/** Face extents in millimetres along the profile-u and extrusion axes. */
export function faceExtentsMm(form: DesignForm, face: Surface): { uMm: number; wMm: number } {
  const envelope = partEnvelopeM(form);
  const frame = FACE_FRAME[face];
  return {
    uMm: (envelope[frame.u * 2 + 1] - envelope[frame.u * 2]) * 1000,
    wMm: (envelope[frame.w * 2 + 1] - envelope[frame.w * 2]) * 1000,
  };
}

/**
 * Proposed size for a fresh sketch. On a part, the piece spans 60% of its
 * face across, keeps the drawn aspect for its height, and extrudes 60% of
 * the face depth. Standing alone it starts at 80 mm across.
 */
export function proposeSketchSize(
  aspect: number,
  form: DesignForm | null,
  face: Surface,
  standalone: boolean,
): { widthMm: number; heightMm: number; depthMm: number } {
  if (standalone || !form) {
    const widthMm = 80;
    return { widthMm, heightMm: clamp(widthMm * aspect, 8, 160), depthMm: 36 };
  }
  const { uMm, wMm } = faceExtentsMm(form, face);
  const widthMm = Math.max(6, 0.6 * uMm);
  return {
    widthMm: round1(widthMm),
    heightMm: round1(clamp(widthMm * aspect, 4, Math.max(8, uMm))),
    depthMm: round1(Math.max(4, 0.6 * wMm)),
  };
}

/** Clamp offsets so the piece footprint stays inside its face (base parts only). */
export function clampOffsets(form: DesignForm, addition: SketchAdditionForm): SketchAdditionForm {
  if (form.kind === "sketch_prism") return addition;
  const { uMm, wMm } = faceExtentsMm(form, addition.face);
  const maxU = Math.max(0, (uMm - addition.widthMm) / 2 - 0.1);
  const maxW = Math.max(0, (wMm - addition.depthMm) / 2 - 0.1);
  return {
    ...addition,
    offsetUMm: clamp(addition.offsetUMm, -maxU, maxU),
    offsetWMm: clamp(addition.offsetWMm, -maxW, maxW),
  };
}

/** World (metre) profile points at one extrusion end, for the viewport ghost. */
export function profilePoints3dM(
  form: DesignForm,
  addition: SketchAdditionForm,
  wFraction: number,
): [number, number, number][] {
  const envelope = partEnvelopeM(form);
  const frame = FACE_FRAME[addition.face];
  const lows = [envelope[0], envelope[2], envelope[4]];
  const highs = [envelope[1], envelope[3], envelope[5]];
  const uCentre = (lows[frame.u] + highs[frame.u]) / 2 + addition.offsetUMm / 1000;
  const wCentre = (lows[frame.w] + highs[frame.w]) / 2 + addition.offsetWMm / 1000;
  const faceCoord = frame.sign > 0 ? highs[frame.v] : lows[frame.v];
  return addition.profile.map((point) => {
    const world: [number, number, number] = [0, 0, 0];
    world[frame.u] = uCentre + (point.u - 0.5) * (addition.widthMm / 1000);
    world[frame.v] = faceCoord + frame.sign * point.v * (addition.heightMm / 1000);
    world[frame.w] = wCentre + (wFraction - 0.5) * (addition.depthMm / 1000);
    return world;
  });
}

/** Placement frame in metres for rendering the extruded sketch piece. */
export function draftPlacementM(
  form: DesignForm,
  addition: SketchAdditionForm,
): {
  origin: [number, number, number];
  uAxis: [number, number, number];
  vAxis: [number, number, number];
  wAxis: [number, number, number];
  widthM: number;
  heightM: number;
  depthM: number;
} {
  const envelope = partEnvelopeM(form);
  const frame = FACE_FRAME[addition.face];
  const lows = [envelope[0], envelope[2], envelope[4]];
  const highs = [envelope[1], envelope[3], envelope[5]];
  const origin: [number, number, number] = [0, 0, 0];
  origin[frame.u] = (lows[frame.u] + highs[frame.u]) / 2 + addition.offsetUMm / 1000;
  origin[frame.v] = frame.sign > 0 ? highs[frame.v] : lows[frame.v];
  origin[frame.w] = (lows[frame.w] + highs[frame.w]) / 2 + addition.offsetWMm / 1000 - addition.depthMm / 2000;
  const axis = (index: number, sign = 1): [number, number, number] => {
    const vector: [number, number, number] = [0, 0, 0];
    vector[index] = sign;
    return vector;
  };
  return {
    origin,
    uAxis: axis(frame.u),
    vAxis: axis(frame.v, frame.sign),
    wAxis: axis(frame.w),
    widthM: addition.widthMm / 1000,
    heightM: addition.heightMm / 1000,
    depthM: addition.depthMm / 1000,
  };
}

export function sketchAdditionLabel(addition: SketchAdditionForm): string {
  return addition.label.trim() || "Sketch piece";
}

function spanAt(profile: SketchPoint[], v: number): number {
  const us = profile.filter((point) => Math.abs(point.v - v) < 0.05).map((point) => point.u);
  if (us.length < 2) return 0;
  return Math.max(...us) - Math.min(...us);
}

function dominantCorners(profile: SketchPoint[]): number {
  // Count direction changes sharper than ~35 degrees around the outline.
  const count = profile.length;
  if (count < 3) return count;
  let corners = 0;
  for (let index = 0; index < count; index += 1) {
    const prev = profile[(index - 1 + count) % count];
    const current = profile[index];
    const next = profile[(index + 1) % count];
    const a = Math.atan2(current.v - prev.v, current.u - prev.u);
    const b = Math.atan2(next.v - current.v, next.u - current.u);
    let turn = Math.abs(b - a);
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    if (turn > 0.6) corners += 1;
  }
  return Math.max(3, Math.min(corners, count));
}

function simplify(points: RawPoint[], tolerance: number): RawPoint[] {
  if (points.length <= 2) return points;
  // Ramer-Douglas-Peucker on the open stroke; closing happens implicitly.
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop()!;
    let farthest = -1;
    let distance = tolerance;
    for (let index = start + 1; index < end; index += 1) {
      const candidate = perpendicularDistance(points[index], points[start], points[end]);
      if (candidate > distance) {
        distance = candidate;
        farthest = index;
      }
    }
    if (farthest > 0) {
      keep[farthest] = true;
      stack.push([start, farthest], [farthest, end]);
    }
  }
  return points.filter((_, index) => keep[index]);
}

function perpendicularDistance(point: RawPoint, start: RawPoint, end: RawPoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  return Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x) / length;
}

function downsample(points: RawPoint[], max: number): RawPoint[] {
  if (points.length <= max) return points;
  const step = points.length / max;
  const result: RawPoint[] = [];
  for (let index = 0; index < max; index += 1) result.push(points[Math.floor(index * step)]);
  return result;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
