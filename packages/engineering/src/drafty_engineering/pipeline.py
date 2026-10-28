"""Run one static analysis from a typed design specification."""

import json
import os
from collections.abc import Callable
from pathlib import Path

import meshio
import numpy as np
import trimesh

from drafty_engineering.analytical import (
    DEFLECTION_TOLERANCE,
    STRESS_TOLERANCE,
    bending_stress_pa,
    tip_deflection_components,
)
from drafty_engineering.cad import build_solid, cad_matches_spec, export_preview_glb, export_step, solid_volume
from drafty_engineering.errors import GeometryError, SolverError
from drafty_engineering.geometry_math import envelope, expected_face_area
from drafty_engineering.materials import get_material
from drafty_engineering.mesh import assess_mesh, mesh_step, tetra_cells
from drafty_engineering.openscad_export import to_openscad
from drafty_engineering.solver import (
    distribute_load,
    fields_from_frd,
    measure_surface_area,
    parse_dat,
    parse_frd_nodal,
    parse_reaction_sum,
    run_calculix,
    select_surface_nodes,
    support_equilibrium,
    write_input,
)
from drafty_engineering.spec import DesignSpec

StatusCallback = Callable[[str, str], None]
UNITS = {"length": "m", "force": "N", "stress": "Pa", "mass": "kg"}


def run_simulation(
    spec: DesignSpec,
    workdir: Path,
    on_status: StatusCallback | None = None,
    cancel_file: Path | None = None,
) -> dict:
    workdir.mkdir(parents=True, exist_ok=True)
    material = get_material(spec.material_id)
    _status(on_status, "geometry", "Building the CAD solid")
    _raise_if_cancelled(cancel_file)
    solid = build_solid(spec)
    volume = solid_volume(solid)
    cad_matches_spec(spec, volume)
    export_step(solid, workdir / "model.step")
    export_preview_glb(solid, workdir / "preview.glb", spec.mesh_size_m)
    (workdir / "model.scad").write_text(to_openscad(spec), encoding="utf-8", newline="\n")

    _status(on_status, "meshing", "Meshing the STEP solid")
    _raise_if_cancelled(cancel_file)
    mesh = mesh_step(workdir / "model.step", workdir / "model.msh", spec)
    points, cells, cell_type = tetra_cells(mesh, spec.element_order)
    quality = assess_mesh(points, cells)
    max_nodes = int(os.environ.get("DRAFTY_MAX_NODES", "250000"))
    if len(points) > max_nodes:
        raise GeometryError(
            f"The mesh has {len(points)} nodes, above the limit of {max_nodes}. Increase the mesh size."
        )
    mesh_volume = _tet_volume(points, cells)
    expected_volume = envelope(spec).volume_m3
    volume_tolerance = 0.05 if spec.kind == "perforated_plate" else 0.02
    if abs(mesh_volume - expected_volume) / expected_volume > volume_tolerance:
        raise GeometryError(
            f"Mesh volume {mesh_volume:.6e} m^3 does not match the solid volume {expected_volume:.6e} m^3."
        )

    support = spec.supports[0]
    fixed_nodes = select_surface_nodes(points, spec, support.surface)
    loaded_nodes = select_surface_nodes(points, spec, spec.loads[0].surface)
    if len(fixed_nodes) == 0:
        raise GeometryError(f"No nodes lie on the support surface {support.surface}.")
    if len(loaded_nodes) == 0:
        raise GeometryError(f"No nodes lie on the load surface {spec.loads[0].surface}.")
    fixed_set = set(fixed_nodes.tolist())
    loaded_set = set(loaded_nodes.tolist())
    if fixed_set <= loaded_set or loaded_set <= fixed_set:
        raise GeometryError(
            "The support and load selections cover the same nodes. "
            "Faces may meet at an edge, but one cannot contain the other."
        )
    support_area = measure_surface_area(points, cells, fixed_nodes)
    expected_support = expected_face_area(spec, support.surface)
    area_tolerance = 0.08 if spec.kind == "perforated_plate" else 0.03
    if abs(support_area - expected_support) / expected_support > area_tolerance:
        raise GeometryError(f"Support area is {support_area:.6e} m^2, expected {expected_support:.6e} m^2.")
    nodal_forces, load_area = distribute_load(points, cells, loaded_nodes, spec)

    _status(on_status, "solving", "Running CalculiX")
    _raise_if_cancelled(cancel_file)
    write_input(
        workdir / "model.inp",
        spec,
        material,
        points,
        cells,
        fixed_nodes,
        nodal_forces,
    )
    timeout_s = int(os.environ.get("DRAFTY_SOLVER_TIMEOUT_S", "300"))
    solver_info = run_calculix(workdir / "model.inp", timeout_s, cancel_file)

    _status(on_status, "postprocessing", "Reading solver output")
    _raise_if_cancelled(cancel_file)
    dat_text = (workdir / "model.dat").read_text(encoding="utf-8", errors="replace")
    frd_text = (workdir / "model.frd").read_text(encoding="utf-8", errors="replace")
    displacements, stresses = parse_dat(dat_text)
    if not displacements or not stresses:
        excerpt = "\n".join(dat_text.splitlines()[:40])
        raise SolverError(f"The solver output did not contain displacements and stresses.\n{excerpt}")
    frd_displacements, frd_stresses = parse_frd_nodal(frd_text)
    displacement, von_mises = fields_from_frd(len(points), frd_displacements, frd_stresses)
    if not np.isfinite(displacement).all() or not np.isfinite(von_mises).all():
        raise SolverError("The solver returned a non-finite displacement or stress field.")
    applied = np.sum(np.stack(list(nodal_forces.values())), axis=0)
    applied_on_support = np.zeros(3)
    for node, force in nodal_forces.items():
        if int(node) in fixed_set:
            applied_on_support += force
    reaction = parse_reaction_sum(dat_text)
    equilibrium = support_equilibrium(applied, applied_on_support, reaction)
    if not equilibrium["passed"]:
        raise SolverError(
            "Reaction forces do not balance the applied load. "
            f"Relative residual is {equilibrium['relative_residual']:.3f}."
        )
    surface = _surface_mesh(points, cells, displacement, von_mises)
    _write_vtu(workdir / "model.vtu", points, cells, cell_type, displacement, von_mises)
    _write_stress_glb(workdir / "results.glb", surface)

    result = _result_payload(
        spec,
        material.yield_strength_pa,
        material.density_kg_m3,
        volume,
        points,
        cells,
        displacement,
        von_mises,
        surface,
        load_area,
        solver_info,
        quality,
        equilibrium,
        loaded_nodes,
    )
    (workdir / "results.json").write_text(json.dumps(result), encoding="utf-8")
    return result


def _result_payload(
    spec: DesignSpec,
    yield_strength_pa: float,
    density: float,
    volume: float,
    points: np.ndarray,
    cells: np.ndarray,
    displacement: np.ndarray,
    von_mises: np.ndarray,
    surface: dict,
    load_area: float,
    solver_info: dict,
    quality: dict,
    equilibrium: dict,
    loaded_nodes: np.ndarray,
) -> dict:
    displacement_magnitude = np.linalg.norm(displacement, axis=1)
    peak_von_mises = float(np.max(von_mises))
    excluded_m = exclusion_distance_m(spec, points, loaded_nodes)
    governing_nodes = _outside_support_zone(points, spec, excluded_m)
    governing_von_mises = float(np.max(von_mises[governing_nodes]))
    if peak_von_mises <= 0 or governing_von_mises <= 0:
        raise SolverError("The solver returned a zero stress field.")
    stress_ratio = governing_von_mises / peak_von_mises
    # A sample below 2% of the contour peak is the unloaded material left
    # behind when the exclusion band swallowed the loaded wall.
    stress_reliable = stress_ratio >= 0.02
    warnings = [
        "Von Mises values are the nodal stresses written by CalculiX to the .frd file.",
        "The contour is drawn on the corner triangles of each tetrahedron. "
        "It is not a full high-order stress interpolation.",
        "Peak von Mises includes the fixed face, where a fully fixed support can create a singularity. "
        f"Governing von Mises drops nodes within {excluded_m:.4e} m of that support.",
        "The factor of safety is yield strength divided by that governing value. "
        "It is an exploratory check, not a certified safety factor.",
    ]
    if not stress_reliable:
        warnings.append(
            "Governing von Mises is below 2% of the contour peak. That sample does not represent "
            "the loaded wall, so the factor is not used to accept a design."
        )
    benchmark = _benchmark(spec, points, displacement, von_mises)
    if benchmark["applicable"] and benchmark["passed"] is False:
        warnings.append("The finite element result is outside the documented beam-theory tolerance.")
    validation = "solver_completed"
    if benchmark["applicable"]:
        validation = "benchmark_passed" if benchmark["passed"] else "benchmark_failed"
    else:
        warnings.append(
            "CalculiX finished this case. It has no closed-form acceptance check, so it is not a passed benchmark."
        )
    return {
        "units": UNITS,
        "validation_status": validation,
        "solver": {
            "name": "calculix",
            "version": solver_info["version"],
            "mode": solver_info["mode"],
            "input": "model.inp",
            "results": ["model.dat", "model.frd"],
        },
        "mesh": {
            "nodes": int(len(points)),
            "elements": int(len(cells)),
            "element_order": spec.element_order,
            "element_type": "C3D10" if spec.element_order == 2 else "C3D4",
            "target_size_m": spec.mesh_size_m,
            "load_area_m2": load_area,
            "quality": quality,
        },
        "equilibrium": equilibrium,
        "mass_kg": volume * density,
        "volume_m3": volume,
        "max_displacement_m": float(np.max(displacement_magnitude)),
        "max_von_mises_pa": peak_von_mises,
        "governing_von_mises_pa": governing_von_mises,
        "yield_strength_pa": yield_strength_pa,
        "safety_factor": yield_strength_pa / governing_von_mises,
        "stress_assessment": {
            "peak_von_mises_pa": peak_von_mises,
            "measure_pa": governing_von_mises,
            "measure": "maximum extrapolated nodal von Mises outside the support zone",
            "exclusion_m": excluded_m,
            "exclusion": f"nodes within {excluded_m:.4e} m of the support",
            "exclusion_reason": (
                "A fully fixed face can create a constraint singularity in the first elements. "
                "The band is two element lengths, and never more than half the distance from "
                "the support to the loaded face."
            ),
            "displayed_surface": "corner triangles of the quadratic tetrahedra, not a high-order interpolation",
            "nodal_field": "extrapolated nodal stresses from the CalculiX .frd file",
            "integration_point_field": "element stresses in the .dat file; not used for the factor",
            "peak_to_governing_ratio": stress_ratio,
            "reliable": stress_reliable,
            "safety_factor_status": "exploratory" if stress_reliable else "unreliable",
            "mesh_sensitivity": "Compare at least two element sizes. One completed solve is not a convergence proof.",
        },
        "quality_gates": {
            "solver_completed": True,
            "equilibrium_verified": bool(equilibrium["passed"]),
            "stress_assessment": "exploratory" if stress_reliable else "unreliable",
            "validated_feasibility": bool(benchmark["applicable"] and benchmark["passed"]),
        },
        "benchmark": benchmark,
        "warnings": warnings,
        "surface": surface,
    }


def _benchmark(
    spec: DesignSpec,
    points: np.ndarray,
    displacement: np.ndarray,
    von_mises: np.ndarray,
) -> dict:
    report: dict = {
        "applicable": False,
        "passed": None,
        "notes": ["This load case has no closed-form acceptance check."],
    }
    if not _is_tip_loaded_cantilever(spec) or spec.beam is None:
        return report
    beam = spec.beam
    material = get_material(spec.material_id)
    force = spec.loads[0].magnitude
    bending, shear = tip_deflection_components(
        force,
        beam.length_m,
        material.youngs_modulus_pa,
        material.poisson_ratio,
        beam.width_m,
        beam.height_m,
    )
    analytical_tip = bending + shear
    direction = np.array([spec.loads[0].direction.x, spec.loads[0].direction.y, spec.loads[0].direction.z])
    tip = points[:, 0] >= beam.length_m - max(spec.mesh_size_m, 0.02 * beam.length_m)
    if not np.any(tip):
        raise SolverError("No nodes were found on the free end for the benchmark.")
    fem_tip = float(np.mean(displacement[tip] @ direction))
    deflection_error = abs(fem_tip - analytical_tip) / analytical_tip
    mid = (points[:, 0] > 0.45 * beam.length_m) & (points[:, 0] < 0.55 * beam.length_m)
    outer = np.abs(points[:, 2]) >= 0.85 * (beam.height_m / 2.0)
    sample = mid & outer
    analytical_stress = bending_stress_pa(force, beam.length_m, beam.width_m, beam.height_m, beam.length_m / 2.0)
    if not np.any(sample):
        raise SolverError("No outer-fiber nodes were found at midspan for the stress check.")
    fem_stress = float(np.mean(von_mises[sample]))
    stress_error = abs(fem_stress - analytical_stress) / analytical_stress
    passed = deflection_error <= DEFLECTION_TOLERANCE and stress_error <= STRESS_TOLERANCE
    return {
        "applicable": True,
        "passed": passed,
        "analytical_bending_deflection_m": bending,
        "analytical_shear_deflection_m": shear,
        "analytical_tip_deflection_m": analytical_tip,
        "fem_tip_deflection_m": fem_tip,
        "deflection_error": deflection_error,
        "deflection_tolerance": DEFLECTION_TOLERANCE,
        "analytical_midspan_stress_pa": analytical_stress,
        "fem_midspan_stress_pa": fem_stress,
        "stress_error": stress_error,
        "stress_tolerance": STRESS_TOLERANCE,
        "reference": (
            "Euler-Bernoulli tip deflection plus rectangular Timoshenko shear; midspan outer-fiber bending stress"
        ),
        "notes": [
            "Deflection is the mean free-end displacement along the load direction.",
            "Stress is the mean von Mises of outer-fiber nodes between 45% and 55% of the span.",
        ],
    }


def _is_tip_loaded_cantilever(spec: DesignSpec) -> bool:
    load = spec.loads[0]
    return (
        spec.kind == "cantilever_beam"
        and spec.supports[0].surface == "xmin"
        and load.surface == "xmax"
        and load.mode == "force"
        and abs(load.direction.z) > 0.99
        and abs(load.direction.x) < 0.01
        and abs(load.direction.y) < 0.01
    )


def exclusion_distance_m(spec: DesignSpec, points: np.ndarray, loaded_nodes: np.ndarray) -> float:
    """Local band around a fully fixed face. It must not swallow the loaded wall."""

    coordinate, axis = _support_axis(spec)
    loaded = np.asarray(loaded_nodes, dtype=int)
    if len(loaded) == 0:
        return 0.0
    far = float(np.max(np.abs(points[loaded, axis] - coordinate)))
    if far <= 0:
        return 0.0
    element_band = 2.0 * spec.mesh_size_m
    # Half the support-to-load distance keeps the outer part of a wall that is
    # only one thickness deep. 1.5 thicknesses removed that entire wall.
    return min(element_band, 0.5 * far)


def _outside_support_zone(points: np.ndarray, spec: DesignSpec, distance_m: float) -> np.ndarray:
    coordinate, axis = _support_axis(spec)
    mask = np.abs(points[:, axis] - coordinate) >= distance_m
    if not np.any(mask):
        return np.ones(len(points), dtype=bool)
    return mask


def _support_axis(spec: DesignSpec) -> tuple[float, int]:
    bounds = envelope(spec)
    surface = spec.supports[0].surface
    coordinate = {
        "xmin": bounds.xmin,
        "xmax": bounds.xmax,
        "ymin": bounds.ymin,
        "ymax": bounds.ymax,
        "zmin": bounds.zmin,
        "zmax": bounds.zmax,
    }[surface]
    axis = {"xmin": 0, "xmax": 0, "ymin": 1, "ymax": 1, "zmin": 2, "zmax": 2}[surface]
    return coordinate, axis


def _surface_mesh(
    points: np.ndarray,
    cells: np.ndarray,
    displacement: np.ndarray,
    von_mises: np.ndarray,
) -> dict:
    counts: dict[tuple[int, int, int], int] = {}
    triangles: dict[tuple[int, int, int], tuple[int, int, int]] = {}
    for cell in cells:
        corners = [int(node) for node in cell[:4]]
        for local in ((0, 1, 2), (0, 1, 3), (0, 2, 3), (1, 2, 3)):
            face = (corners[local[0]], corners[local[1]], corners[local[2]])
            key = tuple(sorted(face))
            counts[key] = counts.get(key, 0) + 1
            triangles[key] = face
    boundary = [triangles[key] for key, count in counts.items() if count == 1]
    used = sorted({node for face in boundary for node in face})
    remap = {node: index for index, node in enumerate(used)}
    return {
        "vertices_m": points[used].tolist(),
        "faces": [[remap[a], remap[b], remap[c]] for a, b, c in boundary],
        "displacement_m": displacement[used].tolist(),
        "von_mises_pa": von_mises[used].tolist(),
    }


def _write_vtu(
    path: Path,
    points: np.ndarray,
    cells: np.ndarray,
    cell_type: str,
    displacement: np.ndarray,
    von_mises: np.ndarray,
) -> None:
    meshio.write_points_cells(
        path,
        points,
        {cell_type: cells},
        point_data={"displacement_m": displacement, "von_mises_pa": von_mises},
    )


def _write_stress_glb(path: Path, surface: dict) -> None:
    vertices = np.asarray(surface["vertices_m"], dtype=float)
    faces = np.asarray(surface["faces"], dtype=np.int64)
    values = np.asarray(surface["von_mises_pa"], dtype=float)
    span = float(np.max(values) - np.min(values))
    normalized = np.zeros_like(values) if span <= 0 else (values - float(np.min(values))) / span
    colors = (_turbo(normalized) * 255).astype(np.uint8)
    opaque = np.concatenate([colors, np.full((len(colors), 1), 255, dtype=np.uint8)], axis=1)
    mesh = trimesh.Trimesh(vertices=vertices, faces=faces, vertex_colors=opaque, process=False)
    mesh.export(path)


def _turbo(values: np.ndarray) -> np.ndarray:
    t = np.clip(values, 0.0, 1.0)
    red = 0.13572138 + t * (
        4.61539260 + t * (-42.66032258 + t * (132.13108234 + t * (-152.94239396 + t * 59.28637943)))
    )
    green = 0.09140261 + t * (2.19418839 + t * (4.84296658 + t * (-14.18503333 + t * (4.27729857 + t * 2.82956604))))
    blue = 0.10667330 + t * (
        12.64194608 + t * (-60.58204836 + t * (110.36276771 + t * (-89.90310912 + t * 27.34824973)))
    )
    return np.clip(np.stack([red, green, blue], axis=1), 0.0, 1.0)


def _tet_volume(points: np.ndarray, cells: np.ndarray) -> float:
    corners = points[cells[:, :4]]
    a = corners[:, 0]
    b = corners[:, 1]
    c = corners[:, 2]
    d = corners[:, 3]
    return float(np.sum(np.abs(np.einsum("ij,ij->i", a - d, np.cross(b - d, c - d)))) / 6.0)


def _status(callback: StatusCallback | None, stage: str, message: str) -> None:
    if callback is not None:
        callback(stage, message)


def _raise_if_cancelled(cancel_file: Path | None) -> None:
    if cancel_file is not None and cancel_file.exists():
        from drafty_engineering.errors import Cancelled

        raise Cancelled("The job was cancelled.")
