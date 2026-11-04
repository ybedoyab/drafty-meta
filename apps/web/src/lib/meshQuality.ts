/** Present Batch 10A mesh-quality fields without inventing values for older jobs. */

export type MeshQualityPayload = {
  element_type?: string | null;
  elements?: number | null;
  elements_checked?: number | null;
  jacobian?: string | null;
  jacobian_validation_method?: string | null;
  jacobian_validation_status?: string | null;
  min_jacobian?: number | null;
  max_jacobian?: number | null;
  normalized_jacobian_ratio_min?: number | null;
  normalized_jacobian_ratio_max?: number | null;
  inverted_elements?: number | null;
  degenerate_elements?: number | null;
  inconclusive_elements?: number | null;
  quality_warnings?: string[] | null;
  certification_note?: string | null;
  low_jacobian_ratio_elements?: number | null;
  low_jacobian_ratio_threshold?: number | null;
};

export type QualityGatesPayload = {
  solver_completed?: boolean | null;
  equilibrium_verified?: boolean | null;
  mesh_validity?: string | null;
  mesh_quality?: string | null;
  stress_assessment?: string | null;
  validated_feasibility?: boolean | null;
};

export type MeshQualityView = {
  available: boolean;
  legacyOnly: boolean;
  elementType: string;
  elementCount: string;
  method: string;
  status: string;
  minJacobian: string;
  maxJacobian: string;
  ratioMin: string;
  inverted: string;
  degenerate: string;
  inconclusive: string;
  softWarnings: string[];
  certificationNote: string;
  wholeElementLabel: "certified_valid" | "inconclusive" | "invalid" | "unavailable";
};

function fmt(value: number | null | undefined, digits = 3): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (Math.abs(value) > 0 && Math.abs(value) < 1e-3) return value.toExponential(digits);
  return value.toPrecision(digits);
}

export function summarizeMeshQuality(
  quality: MeshQualityPayload | null | undefined,
  mesh?: { element_type?: string; elements?: number } | null,
): MeshQualityView {
  const q = quality || {};
  const hasBatch10a = Boolean(q.jacobian_validation_method || q.jacobian_validation_status);
  const legacyOnly = !hasBatch10a && Boolean(q.jacobian || mesh?.element_type);
  const status = String(q.jacobian_validation_status || "");
  let whole: MeshQualityView["wholeElementLabel"] = "unavailable";
  if (status.includes("invalid")) whole = "invalid";
  else if (status === "certified_valid") whole = "certified_valid";
  else if (hasBatch10a) whole = "inconclusive";

  const softWarnings = Array.isArray(q.quality_warnings)
    ? q.quality_warnings.filter((item) => typeof item === "string" && item.trim())
    : [];

  return {
    available: hasBatch10a || legacyOnly,
    legacyOnly,
    elementType: String(q.element_type || mesh?.element_type || "—"),
    elementCount: String(
      q.elements_checked ?? q.elements ?? mesh?.elements ?? "—",
    ),
    method: hasBatch10a
      ? String(q.jacobian_validation_method)
      : q.jacobian
        ? "legacy corner-volume check"
        : "—",
    status: hasBatch10a
      ? String(q.jacobian_validation_status)
      : q.jacobian
        ? "legacy"
        : "unavailable",
    minJacobian: fmt(q.min_jacobian ?? null),
    maxJacobian: fmt(q.max_jacobian ?? null),
    ratioMin: fmt(q.normalized_jacobian_ratio_min ?? null),
    inverted: q.inverted_elements == null ? "—" : String(q.inverted_elements),
    degenerate: q.degenerate_elements == null ? "—" : String(q.degenerate_elements),
    inconclusive: q.inconclusive_elements == null ? "—" : String(q.inconclusive_elements),
    softWarnings,
    certificationNote:
      q.certification_note ||
      (hasBatch10a
        ? "Sampled Jacobian validity is not a whole-element certification."
        : "This job predates Batch 10A mesh-quality metadata."),
    wholeElementLabel: whole,
  };
}

export function gateLabel(value: string | boolean | null | undefined): string {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "passed" : "failed";
  return String(value);
}
