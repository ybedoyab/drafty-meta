"""Optional OpenSCAD text export. It is not the geometry used for analysis."""

from drafty_engineering.spec import DesignSpec, hole_centers
from drafty_engineering.units import meters_to_mm


def to_openscad(spec: DesignSpec) -> str:
    header = (
        "// Optional preview export generated from the typed design specification.\n"
        "// Dimensions are millimeters. Finite element analysis uses the STEP solid, not this file.\n"
    )
    if spec.kind == "cantilever_beam" and spec.beam:
        beam = spec.beam
        return f"{header}cube([{_mm(beam.length_m)}, {_mm(beam.width_m)}, {_mm(beam.height_m)}], center=false);\n"
    if spec.kind == "plate" and spec.plate:
        plate = spec.plate
        return f"{header}cube([{_mm(plate.length_m)}, {_mm(plate.width_m)}, {_mm(plate.thickness_m)}], center=false);\n"
    if spec.kind == "l_bracket" and spec.bracket:
        bracket = spec.bracket
        return (
            f"{header}"
            "union() {\n"
            f"  cube([{_mm(bracket.leg_x_m)}, {_mm(bracket.width_m)}, {_mm(bracket.thickness_m)}], center=false);\n"
            f"  cube([{_mm(bracket.thickness_m)}, {_mm(bracket.width_m)}, {_mm(bracket.leg_z_m)}], center=false);\n"
            "}\n"
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
        return "\n".join(lines) + "\n"
    raise ValueError(f"No OpenSCAD export is defined for {spec.kind}.")


def _mm(value_m: float) -> str:
    return _num(meters_to_mm(value_m))


def _num(value: float) -> str:
    return f"{value:.6f}".rstrip("0").rstrip(".")
