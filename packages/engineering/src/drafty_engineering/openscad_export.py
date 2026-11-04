"""Optional OpenSCAD text export. It is not the geometry used for analysis."""

from drafty_engineering.spec import DesignSpec, addition_profile_points_3d, base_bounds, hole_centers
from drafty_engineering.units import meters_to_mm


def _sketch_polyhedron(spec: DesignSpec, addition_index: int) -> str:
    addition = spec.additions[addition_index]
    base = base_bounds(spec) or (0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
    # OpenSCAD cubes above start at the origin; CAD solids centre Y (and beam Z).
    shift = [0.0, 0.0, 0.0]
    if spec.kind == "cantilever_beam" and spec.beam:
        shift = [0.0, spec.beam.width_m / 2.0, spec.beam.height_m / 2.0]
    elif spec.kind in {"plate", "perforated_plate"} and spec.plate:
        shift = [0.0, spec.plate.width_m / 2.0, 0.0]
    elif spec.kind == "l_bracket" and spec.bracket:
        shift = [0.0, spec.bracket.width_m / 2.0, 0.0]
    elif spec.kind == "sketch_prism":
        shift = [0.0, addition.depth_m / 2.0, 0.0]
    front = addition_profile_points_3d(addition, base, 0.0)
    back = addition_profile_points_3d(addition, base, 1.0)
    points = front + back
    count = len(front)
    rendered = ", ".join(
        "[" + ", ".join(_num(meters_to_mm(value + shift[axis])) for axis, value in enumerate(point)) + "]"
        for point in points
    )
    faces = [list(reversed(range(count))), list(range(count, 2 * count))]
    for index in range(count):
        nxt = (index + 1) % count
        faces.append([index, nxt, count + nxt, count + index])
    rendered_faces = ", ".join("[" + ", ".join(str(face) for face in face) + "]" for face in faces)
    return f"polyhedron(points=[{rendered}], faces=[{rendered_faces}]);"


def _with_additions(spec: DesignSpec, header: str, body: str) -> str:
    if not spec.additions:
        return f"{header}{body}"
    pieces = "\n".join(f"  {_sketch_polyhedron(spec, index)}" for index in range(len(spec.additions)))
    return f"{header}union() {{\n{body}{pieces}\n}}\n"


def to_openscad(spec: DesignSpec) -> str:
    header = (
        "// Optional preview export generated from the typed design specification.\n"
        "// Dimensions are millimeters. Finite element analysis uses the STEP solid, not this file.\n"
    )
    if spec.kind == "cantilever_beam" and spec.beam:
        beam = spec.beam
        body = f"cube([{_mm(beam.length_m)}, {_mm(beam.width_m)}, {_mm(beam.height_m)}], center=false);\n"
        return _with_additions(spec, header, body)
    if spec.kind == "plate" and spec.plate:
        plate = spec.plate
        body = f"cube([{_mm(plate.length_m)}, {_mm(plate.width_m)}, {_mm(plate.thickness_m)}], center=false);\n"
        return _with_additions(spec, header, body)
    if spec.kind == "l_bracket" and spec.bracket:
        bracket = spec.bracket
        return (
            f"{header}"
            "union() {\n"
            f"  cube([{_mm(bracket.leg_x_m)}, {_mm(bracket.width_m)}, {_mm(bracket.thickness_m)}], center=false);\n"
            f"  cube([{_mm(bracket.thickness_m)}, {_mm(bracket.width_m)}, {_mm(bracket.leg_z_m)}], center=false);\n"
            "}\n" + "".join(_sketch_polyhedron(spec, i) + "\n" for i in range(len(spec.additions)))
        )
    if spec.kind == "perforated_plate" and spec.plate and spec.holes:
        plate = spec.plate
        lines = [
            header.rstrip("\n"),
            "difference() {",
            f"  cube([{_mm(plate.length_m)}, {_mm(plate.width_m)}, {_mm(plate.thickness_m)}], center=false);",
        ]
        for center_x, center_y in hole_centers(plate, spec.holes):
            x_mm = meters_to_mm(center_x)
            y_mm = meters_to_mm(center_y + plate.width_m / 2.0)
            lines.append(
                f"  translate([{_num(x_mm)}, {_num(y_mm)}, -1]) "
                f"cylinder(h={_mm(plate.thickness_m + 0.002)}, r={_mm(spec.holes.radius_m)}, $fn=48);"
            )
        lines.append("}")
        return "\n".join(lines) + "\n" + "".join(_sketch_polyhedron(spec, i) + "\n" for i in range(len(spec.additions)))
    if spec.kind == "sketch_prism" and spec.additions:
        return f"{header}{_sketch_polyhedron(spec, 0)}\n"
    raise ValueError(f"No OpenSCAD export is defined for {spec.kind}.")


def _mm(value_m: float) -> str:
    return _num(meters_to_mm(value_m))


def _num(value: float) -> str:
    return f"{value:.6f}".rstrip("0").rstrip(".")
