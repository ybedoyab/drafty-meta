import pytest
from pydantic import ValidationError

from drafty_engineering.optimize import _is_feasible, _with_thickness
from drafty_engineering.spec import bracket_spec, cantilever_benchmark_spec


def test_bracket_thickness_at_least_a_leg_is_rejected():
    spec = bracket_spec()
    assert spec.bracket is not None
    with pytest.raises(ValidationError, match="longer than the thickness"):
        _with_thickness(spec, spec.bracket.leg_x_m)


def test_thickness_that_breaks_the_mesh_bound_is_rejected():
    spec = cantilever_benchmark_spec()
    with pytest.raises(ValidationError, match="Mesh size"):
        _with_thickness(spec, spec.mesh_size_m)


def test_a_valid_thickness_keeps_the_rest_of_the_beam():
    spec = cantilever_benchmark_spec()
    updated = _with_thickness(spec, 0.010)
    assert updated.beam is not None and spec.beam is not None
    assert updated.beam.height_m == pytest.approx(0.010)
    assert updated.beam.length_m == spec.beam.length_m
    assert updated.beam.width_m == spec.beam.width_m
    assert updated.loads == spec.loads


def test_a_failed_benchmark_is_never_feasible():
    result = {"validation_status": "benchmark_failed", "safety_factor": 8.0}
    assert _is_feasible(result, 1.5, 0.001, None) is False
