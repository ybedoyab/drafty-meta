"""Expected solid dimensions used to check the mesh against the design."""

import math
from dataclasses import dataclass

from drafty_engineering.spec import DesignSpec, hole_centers


@dataclass(frozen=True)
class Envelope:
    xmin: float
    xmax: float
    ymin: float
    ymax: float
    zmin: float
    zmax: float
    volume_m3: float


def envelope(spec: DesignSpec) -> Envelope:
    if spec.kind == "cantilever_beam" and spec.beam:
        beam = spec.beam
        return Envelope(
            0.0,
            beam.length_m,
            -beam.width_m / 2.0,
            beam.width_m / 2.0,
            -beam.height_m / 2.0,
            beam.height_m / 2.0,
            beam.length_m * beam.width_m * beam.height_m,
        )
    if spec.kind in {"plate", "perforated_plate"} and spec.plate:
        plate = spec.plate
        volume = plate.length_m * plate.width_m * plate.thickness_m
        if spec.kind == "perforated_plate" and spec.holes:
            count = spec.holes.count_x * spec.holes.count_y
            volume -= count * math.pi * spec.holes.radius_m**2 * plate.thickness_m
        return Envelope(
            0.0,
            plate.length_m,
            -plate.width_m / 2.0,
            plate.width_m / 2.0,
            0.0,
            plate.thickness_m,
            volume,
        )
    if spec.bracket:
        bracket = spec.bracket
        volume = bracket.width_m * bracket.thickness_m * (bracket.leg_x_m + bracket.leg_z_m - bracket.thickness_m)
        return Envelope(
            0.0,
            bracket.leg_x_m,
            -bracket.width_m / 2.0,
            bracket.width_m / 2.0,
            0.0,
            bracket.leg_z_m,
            volume,
        )
    raise ValueError("The design has no envelope.")


def expected_face_area(spec: DesignSpec, surface: str) -> float:
    if spec.kind == "cantilever_beam" and spec.beam:
        beam = spec.beam
        areas = {
            "xmin": beam.width_m * beam.height_m,
            "xmax": beam.width_m * beam.height_m,
            "ymin": beam.length_m * beam.height_m,
            "ymax": beam.length_m * beam.height_m,
            "zmin": beam.length_m * beam.width_m,
            "zmax": beam.length_m * beam.width_m,
        }
        return areas[surface]
    if spec.kind in {"plate", "perforated_plate"} and spec.plate:
        plate = spec.plate
        top = plate.length_m * plate.width_m
        if spec.kind == "perforated_plate" and spec.holes and surface in {"zmin", "zmax"}:
            count = len(hole_centers(plate, spec.holes))
            top -= count * math.pi * spec.holes.radius_m**2
        areas = {
            "xmin": plate.width_m * plate.thickness_m,
            "xmax": plate.width_m * plate.thickness_m,
            "ymin": plate.length_m * plate.thickness_m,
            "ymax": plate.length_m * plate.thickness_m,
            "zmin": top,
            "zmax": top,
        }
        return areas[surface]
    if spec.bracket:
        bracket = spec.bracket
        areas = {
            "xmin": bracket.width_m * bracket.leg_z_m,
            "xmax": bracket.width_m * bracket.thickness_m,
            "ymin": bracket.thickness_m * (bracket.leg_x_m + bracket.leg_z_m - bracket.thickness_m),
            "ymax": bracket.thickness_m * (bracket.leg_x_m + bracket.leg_z_m - bracket.thickness_m),
            "zmin": bracket.width_m * bracket.leg_x_m,
            "zmax": bracket.width_m * bracket.thickness_m,
        }
        return areas[surface]
    raise ValueError(f"No area is defined for surface {surface}.")
