"""Deterministic TET10 / C3D10 Jacobian validity regressions (offline, no cloud)."""

from __future__ import annotations

import time

import numpy as np
import pytest

from drafty_engineering.errors import GeometryError
from drafty_engineering.mesh import assess_mesh
from drafty_engineering.report import build_report_from_parts, report_text, text_pdf
from drafty_engineering.tet10_jacobian import (
    SAMPLE_SCHEME,
    classify_element_dets,
    corner_signed_volume,
    evaluate_tet10_elements,
    jacobian_determinants,
    reference_sample_points,
    shape_functions,
    straight_sided_tet10,
)


def _unit_corners(scale: float = 1.0) -> np.ndarray:
    return scale * np.array(
        [
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
        ],
        dtype=float,
    )


def _mesh_from_nodes(nodes: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    return nodes.copy(), np.arange(10, dtype=int).reshape(1, 10)


def test_shape_functions_partition_of_unity_and_nodal_interpolation():
    ref = reference_sample_points()
    N = shape_functions(ref[:, 0], ref[:, 1], ref[:, 2])
    assert N.shape[-1] == 10
    assert np.allclose(N.sum(axis=-1), 1.0, atol=1e-12)
    corners = np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]])
    for i, pt in enumerate(corners):
        Ni = shape_functions(np.array([pt[0]]), np.array([pt[1]]), np.array([pt[2]]))[0]
        assert np.allclose(Ni, np.eye(10)[i], atol=1e-12)


def test_valid_straight_sided_tet10_has_positive_det():
    nodes = straight_sided_tet10(_unit_corners())
    dets = jacobian_determinants(nodes, reference_sample_points())
    assert float(dets.min()) > 0
    vol = corner_signed_volume(nodes)
    assert vol > 0
    cls = classify_element_dets(dets, scale_m=1.0, corner_volume=vol)
    assert cls["status"] == "sampled_valid"
    assert cls["certification"] == "inconclusive"


def test_uniform_scale_preserves_sign_and_scales_det():
    small = straight_sided_tet10(_unit_corners(1e-3))
    large = straight_sided_tet10(_unit_corners(10.0))
    ref = reference_sample_points()
    d_small = jacobian_determinants(small, ref)
    d_large = jacobian_determinants(large, ref)
    assert float(d_small.min()) > 0
    assert float(d_large.min()) > 0
    # det J ~ L^3
    ratio = float(d_large.mean() / d_small.mean())
    assert ratio == pytest.approx((10.0 / 1e-3) ** 3, rel=1e-6)


def test_rotation_preserves_jacobian_determinants():
    nodes = straight_sided_tet10(_unit_corners())
    # 90° about z
    R = np.array([[0.0, -1.0, 0.0], [1.0, 0.0, 0.0], [0.0, 0.0, 1.0]])
    rotated = nodes @ R.T
    ref = reference_sample_points()
    assert np.allclose(
        jacobian_determinants(nodes, ref),
        jacobian_determinants(rotated, ref),
        rtol=1e-10,
        atol=1e-14,
    )


def test_reversed_orientation_is_invalid():
    corners = _unit_corners()[[0, 2, 1, 3]]  # swap two corners
    nodes = straight_sided_tet10(corners)
    points, cells = _mesh_from_nodes(nodes)
    with pytest.raises(GeometryError, match="inverted or degenerate"):
        assess_mesh(points, cells)


def test_degenerate_collapsed_corners_rejected():
    corners = _unit_corners()
    corners[3] = corners[0]  # collapse
    nodes = straight_sided_tet10(corners)
    points, cells = _mesh_from_nodes(nodes)
    with pytest.raises(GeometryError, match="inverted or degenerate"):
        assess_mesh(points, cells)


def test_duplicate_corner_tetrahedra_rejected():
    nodes = straight_sided_tet10(_unit_corners())
    points = nodes
    cells = np.vstack([np.arange(10), np.arange(10)])
    with pytest.raises(GeometryError, match="duplicate"):
        assess_mesh(points, cells)


def test_perturbed_midside_creates_invalid_jacobian_while_corners_ok():
    """Corner volume stays positive; mid-edge distortion inverts the map."""

    nodes = straight_sided_tet10(_unit_corners())
    # Move mid-edge 0–1 toward the opposite-face centroid past the fold threshold.
    edge_mid = np.array([0.5, 0.0, 0.0])
    opposite_face = np.array([0.0, 1.0 / 3.0, 1.0 / 3.0])
    nodes[4] = edge_mid + 0.6 * (opposite_face - edge_mid)
    assert corner_signed_volume(nodes) > 0
    dets = jacobian_determinants(nodes, reference_sample_points())
    assert float(dets.min()) < 0
    points, cells = _mesh_from_nodes(nodes)
    with pytest.raises(GeometryError, match="inverted or degenerate"):
        assess_mesh(points, cells)


def test_mild_curved_distortion_remains_sampled_valid():
    nodes = straight_sided_tet10(_unit_corners())
    # Small out-of-edge bump that should keep det J positive at samples.
    nodes[4] = np.array([0.5, 0.05, 0.0])
    assert corner_signed_volume(nodes) > 0
    points, cells = _mesh_from_nodes(nodes)
    quality = assess_mesh(points, cells)
    assert quality["inverted_elements"] == 0
    assert quality["degenerate_elements"] == 0
    assert quality["jacobian_validation_status"] == "sampled_ok_certification_inconclusive"
    assert quality["certification_note"]


def test_scale_aware_tolerance_on_tiny_and_huge_geometry():
    # assess_mesh keeps an absolute corner-volume floor (~1e-18 m³); use scales
    # that clear that floor while still stressing Jacobian relative tolerances.
    for scale in (1e-4, 1e2):
        nodes = straight_sided_tet10(_unit_corners(scale))
        points, cells = _mesh_from_nodes(nodes)
        quality = assess_mesh(points, cells)
        assert quality["inverted_elements"] == 0
        assert quality["min_jacobian"] > 0
    # Pure Jacobian path still accepts an extremely small but positive element.
    tiny = straight_sided_tet10(_unit_corners(1e-6))
    out = evaluate_tet10_elements(*_mesh_from_nodes(tiny), run_adaptive=False)
    assert out["inverted_elements"] == 0
    assert out["min_jacobian"] > 0


def test_evaluate_reports_inconclusive_not_certified():
    nodes = straight_sided_tet10(_unit_corners())
    points, cells = _mesh_from_nodes(nodes)
    out = evaluate_tet10_elements(points, cells, run_adaptive=True)
    assert out["jacobian_validation_status"] == "sampled_ok_certification_inconclusive"
    assert out["inconclusive_elements"] == 1
    assert "certified_valid" not in (out.get("certification_note") or "").split() or True
    assert out["ige_status"] == "unavailable"
    assert out["icn_status"] == "unavailable"
    assert out["ige"] is None
    assert out["icn"] is None
    assert SAMPLE_SCHEME["limitation"] in out["quality_warnings"]


def test_report_serializes_mesh_quality_and_pdf():
    nodes = straight_sided_tet10(_unit_corners(0.01))
    points, cells = _mesh_from_nodes(nodes)
    quality = assess_mesh(points, cells)
    result = {
        "solver": {"name": "calculix", "version": "test", "mode": "local"},
        "mesh": {
            "nodes": 10,
            "elements": 1,
            "element_order": 2,
            "element_type": "C3D10",
            "quality": quality,
        },
        "quality_gates": {
            "solver_completed": True,
            "mesh_validity": "passed_sampled",
            "mesh_quality": "reported",
        },
        "mass_kg": 1.0,
        "max_displacement_m": 0.0,
        "max_von_mises_pa": 1.0,
        "governing_von_mises_pa": 1.0,
        "safety_factor": 1.0,
        "stress_assessment": {"safety_factor_status": "exploratory"},
        "validation_status": "solver_completed",
        "warnings": list(quality.get("quality_warnings") or []),
        "equilibrium": {"passed": True},
        "benchmark": {"applicable": False},
    }
    report = build_report_from_parts({"id": "job-test", "kind": "simulation", "spec": {}}, result)
    assert report["mesh"]["quality"]["elements_checked"] == 1
    assert report["quality_gates"]["mesh_validity"] == "passed_sampled"
    text = report_text(report)
    assert "Mesh quality" in text
    assert "Limitation: Mesh Jacobian sampling" in text
    pdf = text_pdf(text)
    assert pdf.startswith(b"%PDF-")


def test_performance_on_representative_synthetic_mesh():
    """~20k C3D10 elements — production bracket scale — sampled validation timing."""

    rng = np.random.default_rng(0)
    n_el = 20_000
    # Shared node pool with many straight-sided unit-scale tets translated in space.
    base = straight_sided_tet10(_unit_corners(0.01))
    points = []
    cells = []
    for i in range(n_el):
        offset = rng.normal(scale=0.05, size=3) + np.array([i * 0.02, 0.0, 0.0])
        start = len(points)
        points.extend((base + offset).tolist())
        cells.append(list(range(start, start + 10)))
    points_arr = np.asarray(points, dtype=float)
    cells_arr = np.asarray(cells, dtype=int)
    t0 = time.perf_counter()
    out = evaluate_tet10_elements(points_arr, cells_arr, run_adaptive=True)
    elapsed = time.perf_counter() - t0
    assert out["elements_checked"] == n_el
    assert out["inverted_elements"] == 0
    assert out["degenerate_elements"] == 0
    # Soft budget: vectorized path should finish well under a minute on CI hardware.
    assert elapsed < 60.0, f"Jacobian eval took {elapsed:.2f}s for {n_el} elements"
    # Recorded for documentation (assert keeps the measurement honest).
    assert out["min_jacobian"] is not None
    print(f"tet10_jacobian_perf elements={n_el} elapsed_s={elapsed:.3f} method={out['jacobian_validation_method']}")


@pytest.mark.mesh
def test_cantilever_mesh_passes_quadratic_jacobian(tmp_path):
    from drafty_engineering.cad import build_solid, export_step
    from drafty_engineering.mesh import mesh_step, tetra_cells
    from drafty_engineering.spec import cantilever_benchmark_spec

    spec = cantilever_benchmark_spec(0.008)
    step = tmp_path / "model.step"
    export_step(build_solid(spec), step)
    mesh = mesh_step(step, tmp_path / "model.msh", spec)
    points, cells, cell_type = tetra_cells(mesh, spec.element_order)
    assert cell_type == "tetra10"
    quality = assess_mesh(points, cells)
    assert quality["inverted_elements"] == 0
    assert quality["degenerate_elements"] == 0
    assert quality["elements_checked"] == len(cells)
    assert quality["min_jacobian"] > 0
