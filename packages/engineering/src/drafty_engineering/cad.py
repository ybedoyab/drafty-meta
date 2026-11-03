"""CadQuery solids. STEP from this module is the geometry the solver meshes."""

from pathlib import Path

import cadquery as cq
import numpy as np
import trimesh

from drafty_engineering.errors import GeometryError
from drafty_engineering.geometry_math import envelope
from drafty_engineering.spec import (
    FACE_FRAME,
    DesignSpec,
    RevolvedProfile,
    SketchAddition,
    addition_profile_points_3d,
    base_bounds,
    hole_centers,
)

REVOLVED_EXPORTS = ("model.step", "model.stl", "preview.glb")


def build_sketch_prism(
    addition: SketchAddition,
    base: tuple[float, float, float, float, float, float],
) -> cq.Workplane:
    """Extrude the sketch profile along its third axis as a CadQuery solid."""

    u_axis, v_axis, w_axis, sign = FACE_FRAME[addition.face]
    points = addition_profile_points_3d(addition, base, 0.0)
    direction = [0.0, 0.0, 0.0]
    direction[w_axis] = addition.depth_m
    if addition.shape == "ellipse":
        wire = _ellipse_wire(addition, points, u_axis, w_axis)
        solid = cq.Solid.extrudeLinear(wire, [], cq.Vector(*direction))
        return cq.Workplane("XY").newObject([solid])
    wire = cq.Wire.makePolygon([cq.Vector(*point) for point in points] + [cq.Vector(*points[0])])
    solid = cq.Solid.extrudeLinear(wire, [], cq.Vector(*direction))
    return cq.Workplane("XY").newObject([solid])


def _ellipse_wire(
    addition: SketchAddition,
    points: list[tuple[float, float, float]],
    u_axis: int,
    w_axis: int,
) -> cq.Wire:
    """A true ellipse wire in the profile plane, centred on the stored outline."""

    # The box midpoint, not the average of points, so the ellipse matches the
    # outline the user saw. A full ellipse is symmetric, so only its centre,
    # radii, and plane matter here.
    centre = [
        (min(point[axis] for point in points) + max(point[axis] for point in points)) / 2.0
        for axis in range(3)
    ]
    u_dir = [0.0, 0.0, 0.0]
    u_dir[u_axis] = 1.0
    normal = [0.0, 0.0, 0.0]
    normal[w_axis] = 1.0
    return cq.Wire.makeEllipse(
        addition.width_m / 2.0,
        addition.height_m / 2.0,
        cq.Vector(*centre),
        cq.Vector(*normal),
        cq.Vector(*u_dir),
    )


def build_solid(spec: DesignSpec) -> cq.Workplane:
    if spec.kind == "sketch_prism" and spec.additions:
        return build_sketch_prism(spec.additions[0], base_bounds(spec) or (0.0, 0.0, 0.0, 0.0, 0.0, 0.0))
    solid = _build_base_solid(spec)
    base = base_bounds(spec)
    if base is not None:
        for addition in spec.additions:
            solid = solid.union(build_sketch_prism(addition, base))
    return solid


def _build_base_solid(spec: DesignSpec) -> cq.Workplane:
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


def build_revolved(profile: RevolvedProfile) -> cq.Workplane:
    """Spin the closed (radius, height) outline a full turn around Z."""

    # On the XZ workplane local x is global X (radius) and local y is global Z (height).
    return cq.Workplane("XZ").polyline(profile.outline()).close().revolve(360.0, (0.0, 0.0, 0.0), (0.0, 1.0, 0.0))


def export_step(solid: cq.Workplane, path: Path, *, mm: bool = False) -> None:
    """Write STEP. The solver path keeps raw metre values; mm=True writes a file CAD tools size correctly."""

    path.parent.mkdir(parents=True, exist_ok=True)
    if mm:
        cq.exporters.export(solid, str(path), exportType="STEP", unit="M", outputUnit="MM")
        return
    cq.exporters.export(solid, str(path))


def export_stl(solid: cq.Workplane, path: Path, tolerance_m: float) -> None:
    """Write a watertight binary STL in millimetres, the unit slicers assume."""

    # OCC leaves a degenerate sliver where a revolved profile meets the axis; merging and
    # dropping zero-area faces closes it.
    vertices, faces = solid.val().tessellate(max(tolerance_m, 1e-6), 0.2)
    points = np.array([[vertex.x, vertex.y, vertex.z] for vertex in vertices], dtype=float) * 1000.0
    mesh = trimesh.Trimesh(vertices=points, faces=np.array(faces, dtype=np.int64), process=True)
    mesh.merge_vertices(digits_vertex=6)
    mesh.update_faces(mesh.nondegenerate_faces())
    mesh.remove_unreferenced_vertices()
    trimesh.repair.fix_normals(mesh)
    if not mesh.is_watertight:
        raise GeometryError("The STL mesh is not watertight. No STL was written.")
    path.parent.mkdir(parents=True, exist_ok=True)
    mesh.export(path, file_type="stl")


def export_revolved(profile: RevolvedProfile, directory: Path) -> dict[str, Path]:
    """Build the revolved solid, check its volume, and write STEP, STL, and the GLB preview."""

    solid = build_revolved(profile)
    revolved_matches_profile(profile, solid_volume(solid))
    tolerance = max(profile.height_m / 500.0, 1e-5)
    paths = {name: directory / name for name in REVOLVED_EXPORTS}
    export_step(solid, paths["model.step"], mm=True)
    export_stl(solid, paths["model.stl"], tolerance)
    export_preview_glb(solid, paths["preview.glb"], tolerance)
    return paths


def revolved_matches_profile(profile: RevolvedProfile, volume_m3: float) -> None:
    expected = profile.volume_m3()
    if expected <= 0 or abs(volume_m3 - expected) / expected > 1e-3:
        raise GeometryError(
            f"Revolved volume {volume_m3:.6e} m^3 does not match the profile volume {expected:.6e} m^3."
        )


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
