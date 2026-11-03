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
function cleanRawPoints(raw: RawPoint[]): RawPoint[] {
  const cleaned: RawPoint[] = [];
  for (const point of raw) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    const last = cleaned[cleaned.length - 1];
    if (!last || Math.hypot(point.x - last.x, point.y - last.y) > 2) cleaned.push(point);
  }
  return cleaned;
}

export function closeSketch(raw: RawPoint[]): SketchPoint[] | null {
  const cleaned = cleanRawPoints(raw);
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

export type SketchShapeKind = "ellipse" | "rectangle" | "trapezoid" | "arch" | "polygon" | "triangle" | "straightened";

export interface BeautifiedSketch {
  kind: SketchShapeKind;
  label: string;
  profile: SketchPoint[];
  /** 0 to 1: how closely the stroke matched the clean shape. */
  confidence: number;
}

const ELLIPSE_POINTS = 32;
const ELLIPSE_MAX_RMS_ERROR = 0.15;

/**
 * Read a freehand stroke as a clean shape, locally and deterministically.
 * Fitting happens on the raw canvas points: the normalized profile squashes
 * each axis to its bounding box, so a circle and an ellipse are identical
 * there. Returns null when nothing matches confidently, in which case the
 * literal simplified outline stands.
 */
export function beautifySketch(raw: RawPoint[]): BeautifiedSketch | null {
  const literal = closeSketch(raw);
  if (!literal) return null;
  return (
    fitRectangle(literal) ??
    fitTrapezoid(literal) ??
    fitArch(literal) ??
    fitRegularPolygon(literal) ??
    fitEllipse(raw) ??
    fitTriangle(literal) ??
    fitStraightened(literal)
  );
}

/**
 * Evenly spaced points along the stroke. Without this, slow parts of a
 * drawing collect more points and pull any fit toward themselves.
 */
function resamplePoints(raw: RawPoint[], spacing: number): RawPoint[] {
  const points = cleanRawPoints(raw);
  if (points.length < 2) return points;
  const result: RawPoint[] = [points[0]];
  let previous = points[0];
  let remaining = spacing;
  for (const current of points.slice(1)) {
    let target = current;
    let distance = Math.hypot(target.x - previous.x, target.y - previous.y);
    while (distance >= remaining && distance > 0) {
      const step = remaining / distance;
      const emitted = {
        x: previous.x + (target.x - previous.x) * step,
        y: previous.y + (target.y - previous.y) * step,
      };
      result.push(emitted);
      previous = emitted;
      distance = Math.hypot(target.x - previous.x, target.y - previous.y);
      remaining = spacing;
    }
    remaining -= distance;
    previous = target;
  }
  const last = points[points.length - 1];
  if (result[result.length - 1] !== last) result.push(last);
  return result;
}

function fitEllipse(raw: RawPoint[]): BeautifiedSketch | null {
  const points = resamplePoints(raw, 4);
  if (points.length < 12) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(...xs) - minX;
  const spanY = Math.max(...ys) - minY;
  if (spanX < 8 || spanY < 8) return null;
  const centreX = minX + spanX / 2;
  const centreY = minY + spanY / 2;
  const radiusX = spanX / 2;
  const radiusY = spanY / 2;

  let squaredError = 0;
  const angles: number[] = [];
  for (const point of points) {
    const dx = (point.x - centreX) / radiusX;
    const dy = (point.y - centreY) / radiusY;
    const radial = Math.hypot(dx, dy);
    squaredError += (radial - 1) ** 2;
    angles.push(Math.atan2(dy, dx));
  }
  const rmsError = Math.sqrt(squaredError / points.length);
  if (rmsError > ELLIPSE_MAX_RMS_ERROR) return null;

  // A partial stroke still completes the shape, as long as it travels well
  // past halfway around. Less than that and a plain curve would qualify.
  angles.sort((a, b) => a - b);
  let widestGap = 0;
  for (let index = 0; index < angles.length; index += 1) {
    const next = angles[(index + 1) % angles.length] + (index === angles.length - 1 ? 2 * Math.PI : 0);
    widestGap = Math.max(widestGap, next - angles[index]);
  }
  if (widestGap > 2.8) return null;
  const coverage = 1 - widestGap / (2 * Math.PI);

  const profile: SketchPoint[] = [];
  for (let index = 0; index < ELLIPSE_POINTS; index += 1) {
    const angle = -Math.PI / 2 + (index / ELLIPSE_POINTS) * 2 * Math.PI;
    profile.push({
      u: round4(0.5 + 0.5 * Math.cos(angle)),
      v: round4(0.5 + 0.5 * Math.sin(angle)),
    });
  }
  const aspect = spanY / spanX;
  return {
    kind: "ellipse",
    label: aspect >= 0.85 && aspect <= 1.18 ? "Disc" : "Oval boss",
    profile,
    // A completed arc is a bigger claim than a tidied full circle.
    confidence: clamp((1 - rmsError * 2) * (0.65 + 0.35 * coverage), 0, 1),
  };
}

function fitRectangle(profile: SketchPoint[]): BeautifiedSketch | null {
  const corners = cornerIndices(profile);
  if (corners.length !== 4) return null;
  const boxCorners: SketchPoint[] = [
    { u: 0, v: 0 },
    { u: 1, v: 0 },
    { u: 1, v: 1 },
    { u: 0, v: 1 },
  ];
  const claimed = new Set<number>();
  for (const index of corners) {
    const point = profile[index];
    const nearest = boxCorners.findIndex(
      (corner, cornerIndex) =>
        !claimed.has(cornerIndex) && Math.hypot(point.u - corner.u, point.v - corner.v) <= 0.14,
    );
    if (nearest < 0) return null;
    claimed.add(nearest);
  }
  // Every kept point should hug an edge; an inset edge means a trapezoid.
  const onEdge = profile.every(
    (point) => Math.min(point.u, 1 - point.u, point.v, 1 - point.v) <= 0.09,
  );
  if (!onEdge) return null;
  return { kind: "rectangle", label: "Block", profile: boxCorners, confidence: 0.9 };
}

function cornerPoints(profile: SketchPoint[]): SketchPoint[] {
  return cornerIndices(profile).map((index) => profile[index]);
}

function segmentDistance(point: SketchPoint, start: SketchPoint, end: SketchPoint): number {
  const dx = end.u - start.u;
  const dy = end.v - start.v;
  const length = Math.hypot(dx, dy);
  if (length === 0) return Math.hypot(point.u - start.u, point.v - start.v);
  return Math.abs(dy * point.u - dx * point.v + end.u * start.v - end.v * start.u) / length;
}

/** True when every point hugs one of the straight segments between corners. */
function nearSegments(points: SketchPoint[], corners: SketchPoint[], tolerance: number): boolean {
  return points.every((point) =>
    corners.some(
      (corner, index) => segmentDistance(point, corner, corners[(index + 1) % corners.length]) <= tolerance,
    ),
  );
}

function simplifiedProfile(profile: SketchPoint[], tolerance: number): SketchPoint[] {
  const scaled = profile.map((point) => ({ x: point.u * 1000, y: (1 - point.v) * 1000 }));
  return simplify(scaled, tolerance * 1000).map((point) => ({
    u: round4(point.x / 1000),
    v: round4(1 - point.y / 1000),
  }));
}

function fitTrapezoid(profile: SketchPoint[]): BeautifiedSketch | null {
  const corners = cornerPoints(profile);
  if (corners.length !== 4) return null;
  if (!nearSegments(profile, corners, 0.03)) return null;
  // Top and bottom edges stay level; their widths must actually differ.
  const top = corners.filter((point) => point.v > 0.5);
  const bottom = corners.filter((point) => point.v <= 0.5);
  if (top.length !== 2 || bottom.length !== 2) return null;
  const widthAt = (pair: SketchPoint[]) => Math.abs(pair[0].u - pair[1].u);
  const topWidth = widthAt(top);
  const bottomWidth = widthAt(bottom);
  if (bottomWidth === 0 || Math.abs(topWidth - bottomWidth) / bottomWidth < 0.15) return null;
  const snapped = corners.map((point) => ({
    u: round4(point.u),
    v: point.v > 0.5 ? Math.max(...top.map((corner) => corner.v)) : Math.min(...bottom.map((corner) => corner.v)),
  }));
  return { kind: "trapezoid", label: "Trapezoid block", profile: snapped, confidence: 0.85 };
}

function fitArch(profile: SketchPoint[]): BeautifiedSketch | null {
  // Two sharp corners, both at the base where the legs meet it; the top is a
  // smooth arc. A circle fails this: its only sharp-ish points sit mid-height.
  const corners = cornerPoints(profile);
  if (corners.length !== 2 || corners.some((point) => point.v > 0.1)) return null;
  const hasBase = profile.some((point) => point.v <= 0.05);
  const leftLeg = profile.filter((point) => point.u <= 0.07);
  const rightLeg = profile.filter((point) => point.u >= 0.93);
  if (!hasBase || !leftLeg.length || !rightLeg.length) return null;
  // The legs end and the arc begins where the sides stop rising vertically.
  const springV = Math.max(
    Math.max(...leftLeg.map((point) => point.v)),
    Math.max(...rightLeg.map((point) => point.v)),
  );
  if (springV <= 0.05 || springV >= 0.95) return null;
  const arcPoints = profile.filter((point) => point.v > springV);
  if (arcPoints.length < 3) return null;
  const arcHeight = 1 - springV;
  const onArc = arcPoints.filter((point) => {
    const radial = Math.hypot((point.u - 0.5) / 0.5, (point.v - springV) / arcHeight);
    return Math.abs(radial - 1) <= 0.18;
  });
  if (onArc.length / arcPoints.length < 0.8) return null;
  const snapped: SketchPoint[] = [
    { u: 0, v: 0 },
    { u: 1, v: 0 },
    { u: 1, v: round4(springV) },
  ];
  for (let index = 1; index < 12; index += 1) {
    const angle = (index / 12) * Math.PI;
    snapped.push({
      u: round4(0.5 + 0.5 * Math.cos(angle)),
      v: round4(springV + arcHeight * Math.sin(angle)),
    });
  }
  snapped.push({ u: 0, v: round4(springV) });
  return { kind: "arch", label: "Arch", profile: snapped, confidence: 0.85 };
}

const POLYGON_LABELS: Record<number, string> = {
  5: "Pentagon block",
  6: "Hexagon block",
  7: "Heptagon block",
  8: "Octagon block",
};

function fitRegularPolygon(profile: SketchPoint[]): BeautifiedSketch | null {
  // Corners come from an aggressively simplified copy, so a jittery hand does
  // not invent extra ones along a straight edge.
  const simplified = simplifiedProfile(profile, 0.02);
  const corners = cornerPoints(simplified);
  if (corners.length < 5 || corners.length > 8) return null;
  // The drawn stroke itself must run straight between the corners. A circle
  // bulges away from every chord, which is what keeps it a Disc.
  if (!nearSegments(profile, corners, 0.03)) return null;
  const edges = corners.map((point, index) => {
    const next = corners[(index + 1) % corners.length];
    return Math.hypot(next.u - point.u, next.v - point.v);
  });
  const meanEdge = edges.reduce((sum, edge) => sum + edge, 0) / edges.length;
  if (meanEdge === 0) return null;
  if (edges.some((edge) => Math.abs(edge - meanEdge) / meanEdge > 0.22)) return null;
  const centreU = corners.reduce((sum, point) => sum + point.u, 0) / corners.length;
  const centreV = corners.reduce((sum, point) => sum + point.v, 0) / corners.length;
  const radiusU = corners.reduce((sum, point) => sum + Math.abs(point.u - centreU), 0) / corners.length;
  const radiusV = corners.reduce((sum, point) => sum + Math.abs(point.v - centreV), 0) / corners.length;
  if (radiusU === 0 || radiusV === 0) return null;
  const startAngle = Math.atan2(
    (corners[0].v - centreV) / radiusV,
    (corners[0].u - centreU) / radiusU,
  );
  const snapped: SketchPoint[] = corners.map((_, index) => {
    const angle = startAngle + (index / corners.length) * 2 * Math.PI;
    return {
      u: round4(centreU + radiusU * Math.cos(angle)),
      v: round4(centreV + radiusV * Math.sin(angle)),
    };
  });
  return {
    kind: "polygon",
    label: POLYGON_LABELS[corners.length] ?? `${corners.length}-sided block`,
    profile: snapped,
    confidence: 0.85,
  };
}

/**
 * Straighten a polygonal outline that is already nearly straight: snap its
 * corners to the bounding box and to shared rows and columns, so near-right
 * angles become true ones. Curved outlines are left exactly as drawn.
 */
function fitStraightened(profile: SketchPoint[]): BeautifiedSketch | null {
  const corners = cornerPoints(profile);
  if (corners.length < 3) return null;
  if (!nearSegments(profile, corners, 0.03)) return null;
  const snapBox = (value: number) => (value <= 0.08 ? 0 : value >= 0.92 ? 1 : round4(value));
  const snapped = corners.map((point) => ({ u: snapBox(point.u), v: snapBox(point.v) }));
  // Align corners that share a near-vertical or near-horizontal edge.
  for (let index = 0; index < snapped.length; index += 1) {
    const current = snapped[index];
    const next = snapped[(index + 1) % snapped.length];
    if (Math.abs(current.u - next.u) <= 0.05) {
      const shared = round4((current.u + next.u) / 2);
      current.u = shared;
      next.u = shared;
    }
    if (Math.abs(current.v - next.v) <= 0.05) {
      const shared = round4((current.v + next.v) / 2);
      current.v = shared;
      next.v = shared;
    }
  }
  if (new Set(snapped.map((point) => `${point.u},${point.v}`)).size !== snapped.length) return null;
  if (JSON.stringify(snapped) === JSON.stringify(corners)) return null;
  return { kind: "straightened", label: "Custom piece", profile: snapped, confidence: 0.8 };
}

function fitTriangle(profile: SketchPoint[]): BeautifiedSketch | null {
  const corners = cornerIndices(profile);
  if (corners.length !== 3) return null;
  const snap = (value: number) => (value <= 0.08 ? 0 : value >= 0.92 ? 1 : round4(value));
  const snapped = corners.map((index) => ({
    u: snap(profile[index].u),
    v: snap(profile[index].v),
  }));
  if (new Set(snapped.map((point) => `${point.u},${point.v}`)).size !== 3) return null;
  let area = 0;
  for (let index = 0; index < snapped.length; index += 1) {
    const current = snapped[index];
    const next = snapped[(index + 1) % snapped.length];
    area += current.u * next.v - next.u * current.v;
  }
  if (Math.abs(area) / 2 < 0.1) return null;
  return { kind: "triangle", label: classifySketch(snapped), profile: snapped, confidence: 0.9 };
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

function cornerIndices(profile: SketchPoint[]): number[] {
  // Indices where the outline changes direction sharper than ~35 degrees.
  const count = profile.length;
  const indices: number[] = [];
  if (count < 3) return indices;
  for (let index = 0; index < count; index += 1) {
    const prev = profile[(index - 1 + count) % count];
    const current = profile[index];
    const next = profile[(index + 1) % count];
    const a = Math.atan2(current.v - prev.v, current.u - prev.u);
    const b = Math.atan2(next.v - current.v, next.u - current.u);
    let turn = Math.abs(b - a);
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    if (turn > 0.6) indices.push(index);
  }
  return indices;
}

function dominantCorners(profile: SketchPoint[]): number {
  const count = profile.length;
  if (count < 3) return count;
  return Math.max(3, Math.min(cornerIndices(profile).length, count));
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
