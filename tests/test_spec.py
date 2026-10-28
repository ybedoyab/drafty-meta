import pytest
from pydantic import ValidationError

from drafty_engineering.spec import (
    Direction,
    Load,
    Support,
    cantilever_benchmark_spec,
    perforated_plate_spec,
)


def test_benchmark_preset_is_explicit():
    spec = cantilever_benchmark_spec()
    assert spec.supports[0].surface == "xmin"
    assert spec.loads[0].surface == "xmax"
    assert spec.loads[0].mode == "force"
    assert spec.loads[0].magnitude == 100
    assert spec.beam is not None
    assert spec.beam.length_m == 0.3


def test_same_surface_is_rejected():
    spec = cantilever_benchmark_spec().model_dump()
    spec["loads"][0]["surface"] = "xmin"
    with pytest.raises(ValidationError):
        cantilever_benchmark_spec().model_validate(spec)


def test_non_unit_direction_is_rejected():
    spec = cantilever_benchmark_spec().model_dump()
    spec["loads"][0]["direction"] = {"x": 0, "y": 0, "z": -100}
    with pytest.raises(ValidationError):
        cantilever_benchmark_spec().model_validate(spec)


def test_missing_geometry_is_rejected():
    payload = cantilever_benchmark_spec().model_dump()
    payload["beam"] = None
    with pytest.raises(ValidationError):
        cantilever_benchmark_spec().model_validate(payload)


def test_non_finite_dimensions_are_rejected():
    payload = cantilever_benchmark_spec().model_dump()
    payload["beam"]["length_m"] = float("nan")
    with pytest.raises(ValidationError):
        cantilever_benchmark_spec().model_validate(payload)
    payload["beam"]["length_m"] = float("inf")
    with pytest.raises(ValidationError):
        cantilever_benchmark_spec().model_validate(payload)


def test_perforated_holes_must_fit():
    spec = perforated_plate_spec().model_dump()
    spec["holes"]["radius_m"] = 0.05
    with pytest.raises(ValidationError):
        perforated_plate_spec().model_validate(spec)


def test_manual_support_and_load_are_required():
    with pytest.raises(ValidationError):
        type(cantilever_benchmark_spec())(
            name="incomplete",
            kind="cantilever_beam",
            material_id="steel_s235",
            mesh_size_m=0.006,
            supports=[Support(surface="xmin")],
            loads=[],
            beam=cantilever_benchmark_spec().beam,
        )


def test_direction_helper_is_used_by_load():
    load = Load(
        surface="xmax",
        mode="force",
        magnitude=10,
        direction=Direction(x=0, y=0, z=-1),
    )
    assert load.direction.magnitude == pytest.approx(1)
