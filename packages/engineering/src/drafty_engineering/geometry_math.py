"""Expected solid dimensions used to check the mesh against the design."""

import math
from dataclasses import dataclass

from drafty_engineering.spec import DesignSpec, addition_bounds, base_bounds, hole_centers


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
    if spec.kind == "sketch_prism" and spec.additions:
        addition = spec.additions[0]
        bounds = addition_bounds(addition, base_bounds(spec) or (0.0, 0.0, 0.0, 0.0, 0.0, 0.0))
        return Envelope(bounds[0], bounds[1], bounds[2], bounds[3], bounds[4], bounds[5], addition.volume_m3())
    base = _base_envelope(spec)
    if not spec.additions:
        return base
    base_box = base_bounds(spec)
    if base_box is None:
        return base
    lows = [base.xmin, base.ymin, base.zmin]
    highs = [base.xmax, base.ymax, base.zmax]
    volume = base.volume_m3
    for addition in spec.additions:
        bounds = addition_bounds(addition, base_box)
        for axis in range(3):
            lows[axis] = min(lows[axis], bounds[axis * 2])
            highs[axis] = max(highs[axis], bounds[axis * 2 + 1])
        volume += addition.volume_m3()
    return Envelope(lows[0], highs[0], lows[1], highs[1], lows[2], highs[2], volume)


def _base_envelope(spec: DesignSpec) -> Envelope:
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
    if spec.kind == "sketch_prism" and spec.additions:
        addition = spec.additions[0]
        bounds = envelope(spec)
        if surface in {"ymin", "ymax"}:
            return addition.profile_area_m2()
        if surface == "zmin":
            bottom_v = min(point.v for point in addition.profile)
            bottom_us = [point.u for point in addition.profile if abs(point.v - bottom_v) < 1e-9]
            span = (max(bottom_us) - min(bottom_us)) * addition.width_m if len(bottom_us) > 1 else 0.0
            return span * addition.depth_m
        areas = {
            "xmin": (bounds.ymax - bounds.ymin) * (bounds.zmax - bounds.zmin),
            "xmax": (bounds.ymax - bounds.ymin) * (bounds.zmax - bounds.zmin),
            "zmax": (bounds.xmax - bounds.xmin) * (bounds.ymax - bounds.ymin),
        }
        return areas.get(surface, addition.profile_area_m2())
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
