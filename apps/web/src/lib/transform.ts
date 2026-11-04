import type { DesignForm, Surface } from "./design";
import { geometrySnapshot, SURFACES } from "./design";

/**
 * Visual editing math: viewport gizmo gestures mapped back into the design form.
 * Geometry axes are the CAD axes: X = length, Y = width, Z = height/thickness.
 */

export type QuarterMatrix = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
];

const IDENTITY: QuarterMatrix = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

/** Bounding-box size in millimetres along the CAD X, Y, and Z axes. */
export function axisSizesMm(form: DesignForm): [number, number, number] {
  if (form.kind === "sketch_prism" && form.additions[0]) {
    const addition = form.additions[0];
    return [addition.widthMm, addition.depthMm, addition.heightMm];
  }
  if (form.kind === "cantilever_beam") return [form.lengthMm, form.widthMm, form.heightMm];
  if (form.kind === "l_bracket") return [form.legXMm, form.widthMm, form.legZMm];
  return [form.lengthMm, form.widthMm, form.thicknessMm];
}

function withAxisSizesMm(form: DesignForm, [x, y, z]: [number, number, number]): DesignForm {
  if (form.kind === "sketch_prism" && form.additions[0]) {
    const addition = form.additions[0];
    return { ...form, additions: [{ ...addition, widthMm: x, depthMm: y, heightMm: z }] };
  }
  if (form.kind === "cantilever_beam") return { ...form, lengthMm: x, widthMm: y, heightMm: z };
  if (form.kind === "l_bracket") return { ...form, legXMm: x, widthMm: y, legZMm: z };
  return { ...form, lengthMm: x, widthMm: y, thicknessMm: z };
}

function cleanDimension(value: number, snapMm: number): number {
  const snapped = snapMm > 0 ? Math.round(value / snapMm) * snapMm : value;
  return Math.max(0.1, Math.round(snapped * 1000) / 1000);
}

/**
 * Scale the part by the gizmo factors along each CAD axis and write the result
 * back into the dimension fields, so Preview and Run use the dragged size.
 * When snapMm is positive, each resulting dimension rounds to that grid step.
 */
export function scaleForm(
  form: DesignForm,
  factors: readonly [number, number, number],
  snapMm = 0,
): DesignForm {
  const sizes = axisSizesMm(form);
  const scaled = sizes.map((size, axis) => {
    const factor = factors[axis];
    return cleanDimension(size * (Number.isFinite(factor) && factor > 0 ? factor : 1), snapMm);
  }) as [number, number, number];
  return withAxisSizesMm(form, scaled);
}

/**
 * True when a visual tool changed the part against how it was loaded:
 * geometry, or the faces and load direction a rotation remaps. A 180-degree
 * flip changes the faces even when every dimension stays the same.
 */
export function hasVisualEdits(form: DesignForm, baseline: DesignForm): boolean {
  const current = geometrySnapshot(form);
  const loaded = geometrySnapshot(baseline);
  if ((Object.keys(current) as (keyof typeof current)[]).some((key) => key !== "additions" && current[key] !== loaded[key])) return true;
  if (JSON.stringify(form.additions) !== JSON.stringify(baseline.additions)) return true;
  return (
    form.support !== baseline.support ||
    form.loadSurface !== baseline.loadSurface ||
    form.directionX !== baseline.directionX ||
    form.directionY !== baseline.directionY ||
    form.directionZ !== baseline.directionZ
  );
}

const FACE_NORMALS: Record<Surface, [number, number, number]> = {
  xmin: [-1, 0, 0],
  xmax: [1, 0, 0],
  ymin: [0, -1, 0],
  ymax: [0, 1, 0],
  zmin: [0, 0, -1],
  zmax: [0, 0, 1],
};

function applyMatrix(matrix: QuarterMatrix, vector: readonly [number, number, number]): [number, number, number] {
  return [
    matrix[0][0] * vector[0] + matrix[0][1] * vector[1] + matrix[0][2] * vector[2],
    matrix[1][0] * vector[0] + matrix[1][1] * vector[1] + matrix[1][2] * vector[2],
    matrix[2][0] * vector[0] + matrix[2][1] * vector[1] + matrix[2][2] * vector[2],
  ];
}

function faceOfNormal(normal: [number, number, number]): Surface | null {
  return SURFACES.find((face) => {
    const candidate = FACE_NORMALS[face];
    return candidate[0] === normal[0] && candidate[1] === normal[1] && candidate[2] === normal[2];
  }) ?? null;
}

function isQuarterRotation(matrix: QuarterMatrix): boolean {
  for (const row of matrix) {
    if (row.some((value) => ![-1, 0, 1].includes(value))) return false;
    if (row.filter((value) => value !== 0).length !== 1) return false;
  }
  for (let column = 0; column < 3; column += 1) {
    if ([matrix[0][column], matrix[1][column], matrix[2][column]].filter((value) => value !== 0).length !== 1) return false;
  }
  const det =
    matrix[0][0] * (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1]) -
    matrix[0][1] * (matrix[1][0] * matrix[2][2] - matrix[1][2] * matrix[2][0]) +
    matrix[0][2] * (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0]);
  return det === 1;
}

function isIdentity(matrix: QuarterMatrix): boolean {
  return matrix.every((row, i) => row.every((value, j) => value === IDENTITY[i][j]));
}

/** Rotation matrix for quarter turns about one CAD axis (right-hand rule). */
export function quarterMatrix(axis: "x" | "y" | "z", turns: number): QuarterMatrix {
  const steps = ((turns % 4) + 4) % 4;
  let matrix = IDENTITY;
  const once: QuarterMatrix =
    axis === "x"
      ? [
          [1, 0, 0],
          [0, 0, -1],
          [0, 1, 0],
        ]
      : axis === "y"
        ? [
            [0, 0, 1],
            [0, 1, 0],
            [-1, 0, 0],
          ]
        : [
            [0, -1, 0],
            [1, 0, 0],
            [0, 0, 1],
          ];
  for (let step = 0; step < steps; step += 1) {
    const next = applyMatrixToMatrix(once, matrix);
    matrix = next;
  }
  return matrix;
}

function applyMatrixToMatrix(a: QuarterMatrix, b: QuarterMatrix): QuarterMatrix {
  const rows = [0, 1, 2].map((i) =>
    [0, 1, 2].map((j) => a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j]),
  );
  return rows as unknown as QuarterMatrix;
}

/**
 * Rotate the part by a quarter-turn rotation, remapping dimensions, the
 * support/load faces, and the load direction so the same material faces stay
 * held and loaded. Returns null when the rotated shape cannot be written as
 * the same kind of spec (an L-bracket, or a perforated plate whose holes
 * would no longer pass through its thickness).
 */
export function rotateForm(form: DesignForm, matrix: QuarterMatrix): DesignForm | null {
  if (!isQuarterRotation(matrix)) return null;
  if (isIdentity(matrix)) return form;
  if (form.kind === "l_bracket") return null;
  if (form.kind === "sketch_prism") return null;
  if (form.kind === "perforated_plate") {
    const holeAxis = applyMatrix(matrix, [0, 0, 1]);
    if (holeAxis[0] !== 0 || holeAxis[1] !== 0) return null;
  }
  const sizes = axisSizesMm(form);
  const rotatedSizes = [0, 1, 2].map((i) =>
    Math.abs(matrix[i][0]) * sizes[0] + Math.abs(matrix[i][1]) * sizes[1] + Math.abs(matrix[i][2]) * sizes[2],
  ) as [number, number, number];
  const support = faceOfNormal(applyMatrix(matrix, FACE_NORMALS[form.support]));
  const loadSurface = faceOfNormal(applyMatrix(matrix, FACE_NORMALS[form.loadSurface]));
  if (!support || !loadSurface) return null;
  const [directionX, directionY, directionZ] = applyMatrix(matrix, [form.directionX, form.directionY, form.directionZ]);
  const next = withAxisSizesMm(
    { ...form, support, loadSurface, directionX, directionY, directionZ },
    rotatedSizes,
  );
  if (form.kind === "perforated_plate" && matrix[0][1] !== 0) {
    // Length and width swapped: the hole grid swaps with them.
    return { ...next, holeCountX: form.holeCountY, holeCountY: form.holeCountX };
  }
  return next;
}
