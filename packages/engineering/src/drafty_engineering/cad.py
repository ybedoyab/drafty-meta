"""CadQuery solids. STEP from this module is the geometry the solver meshes."""

from pathlib import Path

import cadquery as cq
import numpy as np
import trimesh

from drafty_engineering.errors import GeometryError
from drafty_engineering.geometry_math import envelope
from drafty_engineering.spec import DesignSpec, hole_centers


def build_solid(spec: DesignSpec) -> cq.Workplane:
    if spec.kind == "cantilever_beam" and spec.beam:
        beam = spec.beam
        return (
            cq.Workplane("XY")
            .box(beam.length_m, beam.width_m, beam.height_m)
            .translate((beam.length_m / 2.0, 0.0, 0.0))
        )
    if spec.kind == "plate" and spec.plate:
        return _plate(spec.plate.length_m, spec.plate.width_m, spec.plate.thickness_m)
    if spec.kind == "l_bracket" and spec.bracket:
        bracket = spec.bracket
        horizontal = (
            cq.Workplane("XY")
            .box(bracket.leg_x_m, bracket.width_m, bracket.thickness_m)
            .translate((bracket.leg_x_m / 2.0, 0.0, bracket.thickness_m / 2.0))
        )
        vertical = (
            cq.Workplane("XY")
            .box(bracket.thickness_m, bracket.width_m, bracket.leg_z_m)
            .translate((bracket.thickness_m / 2.0, 0.0, bracket.leg_z_m / 2.0))
        )
        return horizontal.union(vertical)
    if spec.kind == "perforated_plate" and spec.plate and spec.holes:
        plate = spec.plate
        solid = _plate(plate.length_m, plate.width_m, plate.thickness_m)
        for center_x, center_y in hole_centers(plate, spec.holes):
            cutter = (
                cq.Workplane("XY")
                .center(center_x, center_y)
                .circle(spec.holes.radius_m)
                .extrude(plate.thickness_m + 0.002)
                .translate((0.0, 0.0, -0.001))
            )
            solid = solid.cut(cutter)
        return solid
    raise ValueError(f"Cannot build geometry for {spec.kind}.")


def solid_volume(solid: cq.Workplane) -> float:
    return float(solid.val().Volume())


def export_step(solid: cq.Workplane, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    cq.exporters.export(solid, str(path))


def export_preview_glb(solid: cq.Workplane, path: Path, tolerance_m: float) -> None:
    shape = solid.val()
    vertices, faces = shape.tessellate(max(tolerance_m, 1e-4))
    points = np.array([[vertex.x, vertex.y, vertex.z] for vertex in vertices], dtype=float)
    triangles = np.array(faces, dtype=np.int64)
    mesh = trimesh.Trimesh(vertices=points, faces=triangles, process=False)
    path.parent.mkdir(parents=True, exist_ok=True)
    mesh.export(path)


def _plate(length_m: float, width_m: float, thickness_m: float) -> cq.Workplane:
    return cq.Workplane("XY").box(length_m, width_m, thickness_m).translate((length_m / 2.0, 0.0, thickness_m / 2.0))


def cad_matches_spec(spec: DesignSpec, volume_m3: float) -> None:
    expected = envelope(spec).volume_m3
    if expected <= 0 or abs(volume_m3 - expected) / expected > 1e-3:
        raise GeometryError(f"CAD volume {volume_m3:.6e} m^3 does not match the design volume {expected:.6e} m^3.")
