export const SURFACES = ["xmin", "xmax", "ymin", "ymax", "zmin", "zmax"] as const;

export type Surface = (typeof SURFACES)[number];
export type PartKind = "cantilever_beam" | "plate" | "l_bracket" | "perforated_plate";

export interface DesignForm {
  name: string;
  kind: PartKind;
  materialId: string;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  thicknessMm: number;
  legXMm: number;
  legZMm: number;
  holeRadiusMm: number;
  holeCountX: number;
  holeCountY: number;
  holeMarginMm: number;
  meshMm: number;
  elementOrder: 1 | 2;
  support: Surface;
  loadSurface: Surface;
  loadMode: "force" | "pressure";
  magnitude: number;
  directionX: number;
  directionY: number;
  directionZ: number;
}

export interface DesignSpec {
  name: string;
  kind: PartKind;
  material_id: string;
  mesh_size_m: number;
  element_order: 1 | 2;
  supports: { surface: Surface; constraint: "encastre" }[];
  loads: {
    surface: Surface;
    mode: "force" | "pressure";
    magnitude: number;
    direction: { x: number; y: number; z: number };
  }[];
  beam: { length_m: number; width_m: number; height_m: number } | null;
  plate: { length_m: number; width_m: number; thickness_m: number } | null;
  bracket: { leg_x_m: number; leg_z_m: number; thickness_m: number; width_m: number } | null;
  holes: { radius_m: number; count_x: number; count_y: number; margin_m: number } | null;
}

export const benchmarkForm: DesignForm = {
  name: "cantilever-benchmark",
  kind: "cantilever_beam",
  materialId: "steel_s235",
  lengthMm: 300,
  widthMm: 20,
  heightMm: 12,
  thicknessMm: 8,
  legXMm: 80,
  legZMm: 80,
  holeRadiusMm: 4,
  holeCountX: 3,
  holeCountY: 1,
  holeMarginMm: 20,
  meshMm: 6,
  elementOrder: 2,
  support: "xmin",
  loadSurface: "xmax",
  loadMode: "force",
  magnitude: 100,
  directionX: 0,
  directionY: 0,
  directionZ: -1,
};

export function formToSpec(form: DesignForm): DesignSpec {
  const spec: DesignSpec = {
    name: form.name.trim() || "design",
    kind: form.kind,
    material_id: form.materialId,
    mesh_size_m: form.meshMm / 1000,
    element_order: form.elementOrder,
    supports: [{ surface: form.support, constraint: "encastre" }],
    loads: [
      {
        surface: form.loadSurface,
        mode: form.loadMode,
        magnitude: form.loadMode === "pressure" ? form.magnitude * 1e6 : form.magnitude,
        direction: unit(form.directionX, form.directionY, form.directionZ),
      },
    ],
    beam: null,
    plate: null,
    bracket: null,
    holes: null,
  };
  if (form.kind === "cantilever_beam") {
    spec.beam = {
      length_m: form.lengthMm / 1000,
      width_m: form.widthMm / 1000,
      height_m: form.heightMm / 1000,
    };
  } else if (form.kind === "l_bracket") {
    spec.bracket = {
      leg_x_m: form.legXMm / 1000,
      leg_z_m: form.legZMm / 1000,
      thickness_m: form.thicknessMm / 1000,
      width_m: form.widthMm / 1000,
    };
  } else {
    spec.plate = {
      length_m: form.lengthMm / 1000,
      width_m: form.widthMm / 1000,
      thickness_m: form.thicknessMm / 1000,
    };
    if (form.kind === "perforated_plate") {
      spec.holes = {
        radius_m: form.holeRadiusMm / 1000,
        count_x: form.holeCountX,
        count_y: form.holeCountY,
        margin_m: form.holeMarginMm / 1000,
      };
    }
  }
  return spec;
}

export function specToForm(spec: DesignSpec, previous: DesignForm): DesignForm {
  const load = spec.loads[0];
  return {
    ...previous,
    name: spec.name,
    kind: spec.kind,
    materialId: spec.material_id,
    meshMm: spec.mesh_size_m * 1000,
    elementOrder: spec.element_order,
    support: spec.supports[0].surface,
    loadSurface: load.surface,
    loadMode: load.mode,
    magnitude: load.mode === "pressure" ? load.magnitude / 1e6 : load.magnitude,
    directionX: load.direction.x,
    directionY: load.direction.y,
    directionZ: load.direction.z,
    lengthMm: (spec.beam?.length_m ?? spec.plate?.length_m ?? previous.lengthMm / 1000) * 1000,
    widthMm: (spec.beam?.width_m ?? spec.plate?.width_m ?? spec.bracket?.width_m ?? previous.widthMm / 1000) * 1000,
    heightMm: (spec.beam?.height_m ?? previous.heightMm / 1000) * 1000,
    thicknessMm:
      (spec.plate?.thickness_m ?? spec.bracket?.thickness_m ?? previous.thicknessMm / 1000) * 1000,
    legXMm: (spec.bracket?.leg_x_m ?? previous.legXMm / 1000) * 1000,
    legZMm: (spec.bracket?.leg_z_m ?? previous.legZMm / 1000) * 1000,
    holeRadiusMm: (spec.holes?.radius_m ?? previous.holeRadiusMm / 1000) * 1000,
    holeCountX: spec.holes?.count_x ?? previous.holeCountX,
    holeCountY: spec.holes?.count_y ?? previous.holeCountY,
    holeMarginMm: (spec.holes?.margin_m ?? previous.holeMarginMm / 1000) * 1000,
  };
}

export function formIssues(form: DesignForm): string[] {
  const issues: string[] = [];
  const dimensions = [form.lengthMm, form.widthMm, form.heightMm, form.thicknessMm, form.meshMm, form.magnitude];
  if (dimensions.some((value) => !Number.isFinite(value) || value <= 0)) {
    issues.push("Dimensions, mesh size, and load magnitude must be finite and positive.");
  }
  if (form.support === form.loadSurface) {
    issues.push("The support and the load must use different faces.");
  }
  const direction = Math.hypot(form.directionX, form.directionY, form.directionZ);
  if (!Number.isFinite(direction) || direction === 0) {
    issues.push("The load direction cannot be zero.");
  }
  return issues;
}

export function mmFromMeters(value: number): number {
  return value * 1000;
}

export function mpaFromPascals(value: number): number {
  return value / 1e6;
}

export function formatEngineering(value: number, digits = 4): string {
  if (!Number.isFinite(value)) return "—";
  const absolute = Math.abs(value);
  if (absolute !== 0 && (absolute < 0.01 || absolute >= 10000)) return value.toExponential(digits);
  return value.toPrecision(digits);
}

function unit(x: number, y: number, z: number) {
  const magnitude = Math.hypot(x, y, z);
  if (magnitude === 0) return { x: 0, y: 0, z: -1 };
  return { x: x / magnitude, y: y / magnitude, z: z / magnitude };
}
