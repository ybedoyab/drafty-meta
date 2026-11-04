"""Quadratic tetrahedron (TET10 / CalculiX C3D10) Jacobian validity.

Reference element and node order
---------------------------------
Natural coordinates (ξ, η, ζ) with barycentric:
  L1 = 1 − ξ − η − ζ,  L2 = ξ,  L3 = η,  L4 = ζ
Domain: ξ ≥ 0, η ≥ 0, ζ ≥ 0, ξ + η + ζ ≤ 1.

Drafty / CalculiX C3D10 node order (0-based), matching ``mesh.TET10_EDGES``:
  0–3  corner nodes at L1…L4 = 1
  4    mid-edge 0–1
  5    mid-edge 1–2
  6    mid-edge 2–0
  7    mid-edge 0–3
  8    mid-edge 1–3
  9    mid-edge 2–3

Lagrange shape functions:
  N_i = L_i (2 L_i − 1)           for corners i = 0…3
  N_e = 4 L_a L_b                 for mid-edge between corners a,b

Mapping: x(ξ) = Σ N_i(ξ) x_i
Jacobian J = ∂x/∂(ξ,η,ζ)  (3×3).  det J has units of volume (m³) in SI.

Validation levels
-----------------
A. **Sampled** — evaluate det J at a fixed reference-point set. Any
   non-positive (relative to element scale) sample ⇒ element **invalid**.
   Passing all samples does **not** prove positivity everywhere.

B. **Certification** — optional adaptive subdivision of the reference tet.
   Finding a negative leaf ⇒ **invalid**. Exhausting the budget with all
   leaves positive ⇒ status **inconclusive** (cannot certify), never
   ``certified_valid`` unless a future Bézier/Gmsh bound is added.

Gmsh ``AnalyseCurvedMesh`` is probed separately when a live Gmsh model exists;
it is not required for the NumPy path used in CI.
"""

from __future__ import annotations

from typing import Any

import numpy as np

# Mid-edge pairs for C3D10 order used throughout Drafty.
_EDGE_PAIRS = ((0, 1), (1, 2), (2, 0), (0, 3), (1, 3), (2, 3))

# Fixed sample set: 4 vertices, 6 edge mids, 4 face centroids, 1 volume centroid,
# plus a 4-point tet quadrature (Keast / common FEM set).
_VERTICES = np.array(
    [
        [0.0, 0.0, 0.0],
        [1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
        [0.0, 0.0, 1.0],
    ],
    dtype=float,
)
_EDGE_MIDS = np.array(
    [
        [0.5, 0.0, 0.0],
        [0.5, 0.5, 0.0],
        [0.0, 0.5, 0.0],
        [0.0, 0.0, 0.5],
        [0.5, 0.0, 0.5],
        [0.0, 0.5, 0.5],
    ],
    dtype=float,
)
_FACE_CENTS = np.array(
    [
        [1.0 / 3.0, 1.0 / 3.0, 0.0],
        [1.0 / 3.0, 0.0, 1.0 / 3.0],
        [0.0, 1.0 / 3.0, 1.0 / 3.0],
        [1.0 / 3.0, 1.0 / 3.0, 1.0 / 3.0],
    ],
    dtype=float,
)
_VOLUME_CENT = np.array([[0.25, 0.25, 0.25]], dtype=float)
# 4-point degree-3 tet rule (positive weights).
_A, _B = 0.5854101966249685, 0.1381966011250105
_QUAD4 = np.array(
    [
        [_A, _B, _B],
        [_B, _A, _B],
        [_B, _B, _A],
        [_B, _B, _B],
    ],
    dtype=float,
)

SAMPLE_SCHEME = {
    "name": "tet10_vertices_edges_faces_centroid_quad4",
    "point_count": int(
        len(_VERTICES) + len(_EDGE_MIDS) + len(_FACE_CENTS) + len(_VOLUME_CENT) + len(_QUAD4)
    ),
    "limitation": (
        "Positive sampled det J does not prove positivity throughout the quadratic "
        "tetrahedron; curved mid-edge distortion can invert the map between samples."
    ),
}


def reference_sample_points() -> np.ndarray:
    return np.vstack([_VERTICES, _EDGE_MIDS, _FACE_CENTS, _VOLUME_CENT, _QUAD4])


def shape_functions(xi: np.ndarray, eta: np.ndarray, zeta: np.ndarray) -> np.ndarray:
    """Return N with shape (…, 10) at reference points."""

    l1 = 1.0 - xi - eta - zeta
    l2 = xi
    l3 = eta
    l4 = zeta
    return np.stack(
        [
            l1 * (2.0 * l1 - 1.0),
            l2 * (2.0 * l2 - 1.0),
            l3 * (2.0 * l3 - 1.0),
            l4 * (2.0 * l4 - 1.0),
            4.0 * l1 * l2,
            4.0 * l2 * l3,
            4.0 * l3 * l1,
            4.0 * l1 * l4,
            4.0 * l2 * l4,
            4.0 * l3 * l4,
        ],
        axis=-1,
    )


def shape_function_derivatives(xi: np.ndarray, eta: np.ndarray, zeta: np.ndarray) -> np.ndarray:
    """Analytical ∂N/∂(ξ,η,ζ). Shape (…, 10, 3)."""

    l1 = 1.0 - xi - eta - zeta
    l2 = xi
    l3 = eta
    l4 = zeta
    # ∂L/∂(ξ,η,ζ)
    # L1: (-1,-1,-1), L2:(1,0,0), L3:(0,1,0), L4:(0,0,1)
    # N_i = L_i(2L_i-1) ⇒ dN_i = (4L_i-1) dL_i
    # N_ab = 4 L_a L_b ⇒ dN = 4 (dL_a L_b + L_a dL_b)
    ones = np.ones_like(xi)
    zeros = np.zeros_like(xi)

    def corner(li: np.ndarray, dli: tuple[np.ndarray, np.ndarray, np.ndarray]) -> np.ndarray:
        factor = 4.0 * li - 1.0
        return np.stack([factor * dli[0], factor * dli[1], factor * dli[2]], axis=-1)

    def mid(
        la: np.ndarray,
        lb: np.ndarray,
        dla: tuple[np.ndarray, np.ndarray, np.ndarray],
        dlb: tuple[np.ndarray, np.ndarray, np.ndarray],
    ) -> np.ndarray:
        return np.stack(
            [
                4.0 * (dla[0] * lb + la * dlb[0]),
                4.0 * (dla[1] * lb + la * dlb[1]),
                4.0 * (dla[2] * lb + la * dlb[2]),
            ],
            axis=-1,
        )

    dl1 = (-ones, -ones, -ones)
    dl2 = (ones, zeros, zeros)
    dl3 = (zeros, ones, zeros)
    dl4 = (zeros, zeros, ones)

    dN = np.stack(
        [
            corner(l1, dl1),
            corner(l2, dl2),
            corner(l3, dl3),
            corner(l4, dl4),
            mid(l1, l2, dl1, dl2),
            mid(l2, l3, dl2, dl3),
            mid(l3, l1, dl3, dl1),
            mid(l1, l4, dl1, dl4),
            mid(l2, l4, dl2, dl4),
            mid(l3, l4, dl3, dl4),
        ],
        axis=-2,
    )
    return dN


def jacobian_determinants(nodes: np.ndarray, ref_points: np.ndarray) -> np.ndarray:
    """det J at each reference point for one or many elements.

    Parameters
    ----------
    nodes:
        (10, 3) or (E, 10, 3) node coordinates in meters.
    ref_points:
        (P, 3) reference (ξ,η,ζ) samples.

    Returns
    -------
    dets:
        (P,) or (E, P) determinants in m³.
    """

    single = nodes.ndim == 2
    if single:
        nodes = nodes[None, ...]
    xi, eta, zeta = ref_points[:, 0], ref_points[:, 1], ref_points[:, 2]
    dN = shape_function_derivatives(xi, eta, zeta)  # (P, 10, 3)
    # J[e,p,a,b] = sum_i nodes[e,i,a] * dN[p,i,b]
    jac = np.einsum("eia,pib->epab", nodes, dN)
    # det of 3x3
    a, b, c = jac[..., 0, :], jac[..., 1, :], jac[..., 2, :]
    dets = (
        a[..., 0] * (b[..., 1] * c[..., 2] - b[..., 2] * c[..., 1])
        - a[..., 1] * (b[..., 0] * c[..., 2] - b[..., 2] * c[..., 0])
        + a[..., 2] * (b[..., 0] * c[..., 1] - b[..., 1] * c[..., 0])
    )
    return dets[0] if single else dets


def characteristic_scale_m(nodes: np.ndarray) -> float:
    """Edge-length scale from the four corners (meters)."""

    corners = nodes[:4]
    lengths = []
    for i, j in ((0, 1), (1, 2), (2, 0), (0, 3), (1, 3), (2, 3)):
        lengths.append(float(np.linalg.norm(corners[j] - corners[i])))
    scale = float(np.median(lengths)) if lengths else 0.0
    return max(scale, 1e-18)


def relative_det_tolerance(scale_m: float) -> float:
    """Absolute det floor ~ (ε * L)^3 so checks are scale-aware."""

    return (1e-8 * scale_m) ** 3


def corner_signed_volume(nodes: np.ndarray) -> float:
    a, b, c, d = nodes[0], nodes[1], nodes[2], nodes[3]
    return float(np.dot(b - a, np.cross(c - a, d - a)) / 6.0)


def classify_element_dets(
    dets: np.ndarray,
    *,
    scale_m: float,
    corner_volume: float,
) -> dict[str, Any]:
    """Classify one element from sampled determinants."""

    tol = relative_det_tolerance(scale_m)
    finite = np.isfinite(dets)
    if not finite.all():
        return {
            "status": "invalid",
            "reason": "non_finite_jacobian",
            "certification": "invalid",
            "min_det": float(np.nanmin(dets)) if dets.size else float("nan"),
            "max_det": float(np.nanmax(dets)) if dets.size else float("nan"),
        }

    # Orientation: expect det sign to match corner volume sign for Drafty ordering.
    # If corner volume is negative, treat as orientation mismatch (invalid for solver path).
    if abs(corner_volume) <= tol:
        return {
            "status": "degenerate",
            "reason": "degenerate_corner_volume",
            "certification": "invalid",
            "min_det": float(dets.min()),
            "max_det": float(dets.max()),
        }
    if corner_volume < 0:
        return {
            "status": "invalid",
            "reason": "reversed_corner_orientation",
            "certification": "invalid",
            "min_det": float(dets.min()),
            "max_det": float(dets.max()),
        }

    # Hard fail: any sample with det <= tol (degenerate) or opposite sign.
    if np.any(dets <= tol):
        return {
            "status": "invalid",
            "reason": "nonpositive_sampled_jacobian",
            "certification": "invalid",
            "min_det": float(dets.min()),
            "max_det": float(dets.max()),
        }

    min_det = float(dets.min())
    max_det = float(dets.max())
    ratio = min_det / max_det if max_det > 0 else 0.0
    return {
        "status": "sampled_valid",
        "reason": None,
        "certification": "inconclusive",
        "min_det": min_det,
        "max_det": max_det,
        "normalized_jacobian_ratio": float(ratio),
    }


def adaptive_search_inversion(
    nodes: np.ndarray,
    *,
    max_depth: int = 3,
    samples_per_cell: int = 5,  # noqa: ARG001 — reserved for denser leaf sampling
) -> dict[str, Any]:
    """Subdivide the reference tet looking for a negative det J.

    Finding one ⇒ invalid. Not finding one ⇒ inconclusive (not a proof).
    """

    scale = characteristic_scale_m(nodes)
    tol = relative_det_tolerance(scale)
    # Each cell: (ξ0,η0,ζ0, size) describing a shrunk tet cornered at origin-like
    # We subdivide by midpoints of a general reference tet with vertices v0..v3.
    cells = [(_VERTICES.copy(), 0)]
    min_seen = float("inf")
    max_seen = float("-inf")
    while cells:
        verts, depth = cells.pop()
        # Sample at cell vertices + centroid
        centroid = verts.mean(axis=0, keepdims=True)
        pts = np.vstack([verts, centroid])
        dets = jacobian_determinants(nodes, pts)
        min_seen = min(min_seen, float(dets.min()))
        max_seen = max(max_seen, float(dets.max()))
        if np.any(dets <= tol):
            return {
                "status": "invalid",
                "certification": "invalid",
                "reason": "adaptive_found_nonpositive_jacobian",
                "min_det": float(dets.min()),
                "max_det": float(dets.max()),
                "depth": depth,
            }
        if depth >= max_depth:
            continue
        # Midpoint subdivision into 8 child tets (Freudenthal-style for tet).
        m01 = 0.5 * (verts[0] + verts[1])
        m12 = 0.5 * (verts[1] + verts[2])
        m20 = 0.5 * (verts[2] + verts[0])
        m03 = 0.5 * (verts[0] + verts[3])
        m13 = 0.5 * (verts[1] + verts[3])
        m23 = 0.5 * (verts[2] + verts[3])
        children = [
            np.vstack([verts[0], m01, m20, m03]),
            np.vstack([verts[1], m12, m01, m13]),
            np.vstack([verts[2], m20, m12, m23]),
            np.vstack([verts[3], m03, m13, m23]),
            np.vstack([m01, m12, m20, m13]),
            np.vstack([m20, m12, m23, m13]),
            np.vstack([m01, m20, m03, m13]),
            np.vstack([m03, m13, m23, m20]),
        ]
        for child in children:
            cells.append((child, depth + 1))
    return {
        "status": "sampled_valid",
        "certification": "inconclusive",
        "reason": "adaptive_no_inversion_found_not_a_proof",
        "min_det": min_seen if min_seen < float("inf") else float("nan"),
        "max_det": max_seen if max_seen > float("-inf") else float("nan"),
        "depth": max_depth,
    }


def evaluate_tet10_elements(
    points: np.ndarray,
    cells: np.ndarray,
    *,
    run_adaptive: bool = True,
    adaptive_ratio_trigger: float = 0.35,
    adaptive_max_depth: int = 2,
    max_elements: int | None = None,
    chunk_size: int = 4096,
) -> dict[str, Any]:
    """Vectorized sampled Jacobian check for a C3D10 mesh.

    Adaptive subdivision runs only on elements that already pass sampling but
    have a low min/max Jacobian ratio (or after an explicit force). It can prove
    invalidity; it never upgrades status to ``certified_valid``.
    """

    if cells.ndim != 2 or cells.shape[1] < 10:
        raise ValueError("C3D10 cells must have shape (E, 10).")
    n = len(cells) if max_elements is None else min(len(cells), max_elements)
    cells = cells[:n]
    ref = reference_sample_points()

    inverted = 0
    degenerate = 0
    inconclusive = 0
    sampled_valid = 0
    adaptive_checked = 0
    warnings: list[str] = []
    min_all = float("inf")
    max_all = float("-inf")
    low_ratio = 0
    ratios: list[float] = []

    for start in range(0, n, chunk_size):
        stop = min(start + chunk_size, n)
        nodes = points[cells[start:stop]]  # (E, 10, 3)
        dets = jacobian_determinants(nodes, ref)  # (E, P)
        a, b, c, d = nodes[:, 0], nodes[:, 1], nodes[:, 2], nodes[:, 3]
        corner_vols = np.einsum("ij,ij->i", b - a, np.cross(c - a, d - a)) / 6.0
        edge_lens = np.stack(
            [
                nodes[:, 1] - nodes[:, 0],
                nodes[:, 2] - nodes[:, 1],
                nodes[:, 0] - nodes[:, 2],
                nodes[:, 3] - nodes[:, 0],
                nodes[:, 3] - nodes[:, 1],
                nodes[:, 3] - nodes[:, 2],
            ],
            axis=1,
        )
        scales = np.maximum(np.median(np.linalg.norm(edge_lens, axis=2), axis=1), 1e-18)
        tols = (1e-8 * scales) ** 3

        finite = np.isfinite(dets).all(axis=1)
        min_d = np.min(dets, axis=1)
        max_d = np.max(dets, axis=1)
        abs_corner = np.abs(corner_vols)
        degenerate_mask = finite & (abs_corner <= tols)
        reversed_mask = finite & (~degenerate_mask) & (corner_vols < 0)
        nonpos_mask = finite & (~degenerate_mask) & (~reversed_mask) & (min_d <= tols)
        invalid_mask = (~finite) | reversed_mask | nonpos_mask
        sampled_ok = finite & (~degenerate_mask) & (~invalid_mask)
        with np.errstate(divide="ignore", invalid="ignore"):
            ratio = np.where(max_d > 0, min_d / max_d, 0.0)

        # Selective adaptive: only suspicious low-ratio sampled-ok elements.
        if run_adaptive:
            suspect = np.nonzero(sampled_ok & (ratio < adaptive_ratio_trigger))[0]
            for local_i in suspect:
                adaptive_checked += 1
                adapt = adaptive_search_inversion(
                    nodes[local_i],
                    max_depth=adaptive_max_depth,
                )
                if adapt["certification"] == "invalid":
                    sampled_ok[local_i] = False
                    invalid_mask[local_i] = True
                    min_d[local_i] = min(float(min_d[local_i]), float(adapt["min_det"]))
                    max_d[local_i] = max(float(max_d[local_i]), float(adapt["max_det"]))

        chunk_min = float(np.nanmin(min_d)) if min_d.size else float("inf")
        chunk_max = float(np.nanmax(max_d)) if max_d.size else float("-inf")
        min_all = min(min_all, chunk_min)
        max_all = max(max_all, chunk_max)

        degenerate += int(np.count_nonzero(degenerate_mask))
        inverted += int(np.count_nonzero(invalid_mask))
        ok_count = int(np.count_nonzero(sampled_ok))
        sampled_valid += ok_count
        inconclusive += ok_count  # NumPy path never certifies
        ok_ratios = ratio[sampled_ok]
        for value in ok_ratios.tolist():
            ratios.append(float(value))
            if value < 0.10:
                low_ratio += 1

    if low_ratio:
        warnings.append(
            f"{low_ratio} element(s) have sampled min/max Jacobian ratio below 0.10 "
            "(soft quality warning; not a hard geometric failure)."
        )
    warnings.append(SAMPLE_SCHEME["limitation"])
    warnings.append(
        "Whole-element certification is inconclusive without a Bézier/Gmsh positivity bound; "
        "adaptive sampling can only prove invalidity, not certify validity."
    )
    if run_adaptive:
        warnings.append(
            f"Adaptive subdivision ran on {adaptive_checked} low-ratio element(s) "
            f"(trigger ratio < {adaptive_ratio_trigger}); not a whole-mesh certification."
        )

    status = "ok"
    if inverted or degenerate:
        status = "invalid"
    elif inconclusive == n and n > 0:
        status = "sampled_ok_certification_inconclusive"

    return {
        "element_type": "C3D10",
        "elements_checked": int(n),
        "jacobian_validation_method": "numpy_tet10_analytical_derivatives+selective_adaptive",
        "jacobian_validation_status": status,
        "jacobian_sample_scheme": SAMPLE_SCHEME,
        "min_jacobian": None if min_all == float("inf") else float(min_all),
        "max_jacobian": None if max_all == float("-inf") else float(max_all),
        "normalized_jacobian_ratio_min": float(min(ratios)) if ratios else None,
        "normalized_jacobian_ratio_max": float(max(ratios)) if ratios else None,
        "inverted_elements": int(inverted),
        "degenerate_elements": int(degenerate),
        "inconclusive_elements": int(inconclusive),
        "sampled_valid_elements": int(sampled_valid),
        "adaptive_elements_checked": int(adaptive_checked),
        "low_jacobian_ratio_elements": int(low_ratio),
        "low_jacobian_ratio_threshold": 0.10,
        "low_jacobian_ratio_percent": float(100.0 * low_ratio / n) if n else 0.0,
        "ige": None,
        "icn": None,
        "ige_status": "unavailable",
        "icn_status": "unavailable",
        "quality_warnings": warnings,
        "certification_note": (
            "certified_valid is never claimed by the NumPy path; "
            "inconclusive means no inversion was demonstrated."
        ),
        "tolerance_note": "det J compared to (1e-8 * characteristic_edge_length)^3",
    }


def straight_sided_tet10(corners: np.ndarray) -> np.ndarray:
    """Build a 10-node tet with mid-edge nodes on straight chords."""

    corners = np.asarray(corners, dtype=float).reshape(4, 3)
    mids = np.array([(corners[i] + corners[j]) * 0.5 for i, j in _EDGE_PAIRS], dtype=float)
    return np.vstack([corners, mids])
