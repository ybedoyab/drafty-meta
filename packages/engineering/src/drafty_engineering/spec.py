"""Parametric design specification. Geometry is explicit; images do not fill it."""

import math
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from drafty_engineering.analytical import (
    BENCHMARK_FORCE_N,
    BENCHMARK_HEIGHT_M,
    BENCHMARK_LENGTH_M,
    BENCHMARK_MESH_M,
    BENCHMARK_WIDTH_M,
)
from drafty_engineering.errors import InputError
from drafty_engineering.materials import MATERIALS

SurfaceName = Literal["xmin", "xmax", "ymin", "ymax", "zmin", "zmax"]
PartKind = Literal["cantilever_beam", "plate", "l_bracket", "perforated_plate"]


class Direction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    x: float
    y: float
    z: float

    @property
    def magnitude(self) -> float:
        return (self.x**2 + self.y**2 + self.z**2) ** 0.5


class Support(BaseModel):
    model_config = ConfigDict(extra="forbid")

    surface: SurfaceName
    constraint: Literal["encastre"] = "encastre"


class Load(BaseModel):
    model_config = ConfigDict(extra="forbid")

    surface: SurfaceName
    mode: Literal["force", "pressure"]
    magnitude: float = Field(gt=0)
    direction: Direction


class BeamGeometry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    length_m: float = Field(gt=0)
    width_m: float = Field(gt=0)
    height_m: float = Field(gt=0)


class PlateGeometry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    length_m: float = Field(gt=0)
    width_m: float = Field(gt=0)
    thickness_m: float = Field(gt=0)


class BracketGeometry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    leg_x_m: float = Field(gt=0)
    leg_z_m: float = Field(gt=0)
    thickness_m: float = Field(gt=0)
    width_m: float = Field(gt=0)


class HolePattern(BaseModel):
    model_config = ConfigDict(extra="forbid")

    radius_m: float = Field(gt=0)
    count_x: int = Field(ge=1, le=12)
    count_y: int = Field(ge=1, le=12)
    margin_m: float = Field(gt=0)


class DesignSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(default="design", min_length=1, max_length=80)
    kind: PartKind
    material_id: str
    mesh_size_m: float = Field(gt=0)
    element_order: Literal[1, 2] = 2
    supports: list[Support] = Field(min_length=1, max_length=1)
    loads: list[Load] = Field(min_length=1, max_length=1)
    beam: BeamGeometry | None = None
    plate: PlateGeometry | None = None
    bracket: BracketGeometry | None = None
    holes: HolePattern | None = None

    @model_validator(mode="after")
    def _validate_design(self) -> "DesignSpec":
        if self.material_id not in MATERIALS:
            known = ", ".join(sorted(MATERIALS))
            raise ValueError(f"Unknown material '{self.material_id}'. Known materials: {known}")
        self._require_finite()
        direction = self.loads[0].direction.magnitude
        if abs(direction - 1.0) > 1e-3:
            raise ValueError("Load direction must be a unit vector. Put the size of the load in magnitude.")
        if self.supports[0].surface == self.loads[0].surface:
            raise ValueError("The support and the load must use different surfaces.")
        self._require_geometry()
        smallest = _smallest_dimension(self)
        if self.mesh_size_m >= smallest:
            raise ValueError("Mesh size must be smaller than the smallest solid dimension.")
        if self.mesh_size_m < smallest / 100.0:
            raise ValueError("Mesh size is finer than 1/100 of the smallest dimension. Coarsen it before solving.")
        return self

    def _require_finite(self) -> None:
        values = [
            self.mesh_size_m,
            self.loads[0].magnitude,
            self.loads[0].direction.x,
            self.loads[0].direction.y,
            self.loads[0].direction.z,
        ]
        if self.beam:
            values.extend([self.beam.length_m, self.beam.width_m, self.beam.height_m])
        if self.plate:
            values.extend([self.plate.length_m, self.plate.width_m, self.plate.thickness_m])
        if self.bracket:
            values.extend([self.bracket.leg_x_m, self.bracket.leg_z_m, self.bracket.thickness_m, self.bracket.width_m])
        if self.holes:
            values.extend([self.holes.radius_m, self.holes.margin_m, self.holes.count_x, self.holes.count_y])
        if any(not math.isfinite(float(value)) for value in values):
            raise ValueError("Dimensions, mesh size, and loads must be finite numbers.")

    def _require_geometry(self) -> None:
        if self.kind == "cantilever_beam":
            if self.beam is None or self.plate or self.bracket or self.holes:
                raise ValueError("A cantilever beam requires only beam geometry.")
            return
        if self.kind == "plate":
            if self.plate is None or self.beam or self.bracket or self.holes:
                raise ValueError("A plate requires only plate geometry.")
            return
        if self.kind == "l_bracket":
            if self.bracket is None or self.beam or self.plate or self.holes:
                raise ValueError("An L-bracket requires only bracket geometry.")
            if self.bracket.thickness_m >= min(self.bracket.leg_x_m, self.bracket.leg_z_m):
                raise ValueError("Each bracket leg must be longer than the thickness.")
            return
        if self.plate is None or self.holes is None or self.beam or self.bracket:
            raise ValueError("A perforated plate requires plate geometry and a hole pattern.")
        _validate_holes(self.plate, self.holes)


def _validate_holes(plate: PlateGeometry, holes: HolePattern) -> None:
    if holes.margin_m <= holes.radius_m:
        raise ValueError("Hole margin must be larger than the hole radius.")
    span_x = plate.length_m - 2.0 * holes.margin_m
    span_y = plate.width_m - 2.0 * holes.margin_m
    if span_x <= 0 or span_y <= 0:
        raise ValueError("The hole margin does not fit inside the plate.")
    if holes.count_x > 1 and span_x / (holes.count_x - 1) < 2.2 * holes.radius_m:
        raise ValueError("Holes overlap along the length.")
    if holes.count_y > 1 and span_y / (holes.count_y - 1) < 2.2 * holes.radius_m:
        raise ValueError("Holes overlap along the width.")


def _smallest_dimension(spec: DesignSpec) -> float:
    if spec.kind == "cantilever_beam" and spec.beam:
        return min(spec.beam.length_m, spec.beam.width_m, spec.beam.height_m)
    if spec.kind in {"plate", "perforated_plate"} and spec.plate:
        return min(spec.plate.length_m, spec.plate.width_m, spec.plate.thickness_m)
    if spec.bracket:
        return min(spec.bracket.leg_x_m, spec.bracket.leg_z_m, spec.bracket.thickness_m, spec.bracket.width_m)
    raise InputError("The design has no geometry.")


def hole_centers(plate: PlateGeometry, holes: HolePattern) -> list[tuple[float, float]]:
    xs = _stations(holes.margin_m, plate.length_m - holes.margin_m, holes.count_x)
    ys = _stations(
        -plate.width_m / 2.0 + holes.margin_m,
        plate.width_m / 2.0 - holes.margin_m,
        holes.count_y,
    )
    return [(x, y) for x in xs for y in ys]


def _stations(start: float, end: float, count: int) -> list[float]:
    if count == 1:
        return [(start + end) / 2.0]
    step = (end - start) / (count - 1)
    return [start + index * step for index in range(count)]


def cantilever_benchmark_spec(mesh_size_m: float = BENCHMARK_MESH_M) -> DesignSpec:
    return DesignSpec(
        name="cantilever-benchmark",
        kind="cantilever_beam",
        material_id="steel_s235",
        mesh_size_m=mesh_size_m,
        element_order=2,
        supports=[Support(surface="xmin")],
        loads=[
            Load(
                surface="xmax",
                mode="force",
                magnitude=BENCHMARK_FORCE_N,
                direction=Direction(x=0, y=0, z=-1),
            )
        ],
        beam=BeamGeometry(
            length_m=BENCHMARK_LENGTH_M,
            width_m=BENCHMARK_WIDTH_M,
            height_m=BENCHMARK_HEIGHT_M,
        ),
    )


def plate_spec() -> DesignSpec:
    return DesignSpec(
        name="cantilever-plate",
        kind="plate",
        material_id="aluminum_6061_t6",
        mesh_size_m=0.006,
        element_order=2,
        supports=[Support(surface="xmin")],
        loads=[
            Load(
                surface="zmax",
                mode="pressure",
                magnitude=10_000.0,
                direction=Direction(x=0, y=0, z=-1),
            )
        ],
        plate=PlateGeometry(length_m=0.160, width_m=0.060, thickness_m=0.008),
    )


def bracket_spec() -> DesignSpec:
    return DesignSpec(
        name="l-bracket",
        kind="l_bracket",
        material_id="steel_s235",
        mesh_size_m=0.004,
        element_order=2,
        supports=[Support(surface="xmin")],
        loads=[
            Load(
                surface="xmax",
                mode="force",
                magnitude=200.0,
                direction=Direction(x=0, y=0, z=-1),
            )
        ],
        bracket=BracketGeometry(leg_x_m=0.080, leg_z_m=0.080, thickness_m=0.008, width_m=0.040),
    )


def perforated_plate_spec() -> DesignSpec:
    return DesignSpec(
        name="perforated-plate",
        kind="perforated_plate",
        material_id="aluminum_6061_t6",
        mesh_size_m=0.003,
        element_order=2,
        supports=[Support(surface="xmin")],
        loads=[
            Load(
                surface="zmax",
                mode="pressure",
                magnitude=8_000.0,
                direction=Direction(x=0, y=0, z=-1),
            )
        ],
        plate=PlateGeometry(length_m=0.120, width_m=0.060, thickness_m=0.006),
        holes=HolePattern(radius_m=0.004, count_x=3, count_y=1, margin_m=0.020),
    )
