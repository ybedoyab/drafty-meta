import pytest

from drafty_engineering.beam_fem import analyze_simply_supported_udl
from drafty_engineering.scenario import i_section_properties, simply_supported_udl


def _section():
    return i_section_properties(0.2, 0.1, 0.01, 0.006)


def _solve(**overrides):
    section = _section()
    values = {
        "load_n_per_m": 12500.0,
        "span_m": 6.0,
        "youngs_modulus_pa": 210e9,
        "inertia_m4": section["inertia_x_m4"],
        "depth_m": 0.2,
        "elements": 16,
        "yield_strength_pa": 235e6,
    }
    values.update(overrides)
    return analyze_simply_supported_udl(**values)


def test_beam_elements_match_the_simple_span_closed_form():
    section = _section()
    closed = simply_supported_udl(12500.0, 6.0, 210e9, section["inertia_x_m4"])
    result = _solve()
    assert result["passed"] is True
    assert result["status"] == "benchmark_passed"
    assert result["solver"]["name"] == "drafty-beam-element"
    assert result["midspan_deflection_m"] == pytest.approx(closed["midspan_deflection_m"], rel=0.01)
    assert result["max_moment_n_m"] == pytest.approx(closed["max_moment_n_m"], rel=0.01)
    assert result["left_reaction_n"] == pytest.approx(12500.0 * 3.0, rel=1e-6)
    assert result["right_reaction_n"] == pytest.approx(result["left_reaction_n"], rel=1e-6)
    assert result["equilibrium"]["residual_relative"] < 1e-8
    assert abs(result["support_moment_left_n_m"]) < 1.0
    stress = result["max_moment_n_m"] * 0.1 / section["inertia_x_m4"]
    assert result["max_elastic_bending_stress_pa"] == pytest.approx(stress, rel=1e-6)
    assert result["elastic_range"] == "above typical yield"
    cantilever_udl = 12500.0 * 6.0**4 / (8.0 * 210e9 * section["inertia_x_m4"])
    assert result["midspan_deflection_m"] < cantilever_udl * 0.2


def test_refinement_reduces_the_quarter_span_interpolation_error():
    errors = [_solve(elements=count)["quarter_span_deflection_error"] for count in (2, 4, 8)]
    assert errors[0] > 1e-4
    assert errors[1] < errors[0] * 0.1
    assert errors[2] <= errors[1] + 1e-9


def test_load_and_span_scale_the_beam_solution():
    base = _solve(load_n_per_m=1000.0, span_m=4.0, elements=8)
    doubled = _solve(load_n_per_m=2000.0, span_m=4.0, elements=8)
    longer = _solve(load_n_per_m=1000.0, span_m=8.0, elements=8)
    assert doubled["max_moment_n_m"] == pytest.approx(2.0 * base["max_moment_n_m"], rel=1e-6)
    assert doubled["midspan_deflection_m"] == pytest.approx(2.0 * base["midspan_deflection_m"], rel=1e-6)
    assert longer["analytical_max_moment_n_m"] == pytest.approx(4.0 * base["analytical_max_moment_n_m"])
    assert longer["analytical_midspan_deflection_m"] == pytest.approx(16.0 * base["analytical_midspan_deflection_m"])
    assert longer["passed"] is True
    assert base["stations"][0]["deflection_m"] == pytest.approx(0.0)
    assert base["stations"][-1]["deflection_m"] == pytest.approx(0.0)
    assert base["stations"][0]["shear_n"] == pytest.approx(base["left_reaction_n"])


@pytest.mark.parametrize(
    ("kwargs", "match"),
    [
        ({"elements": 1}, "2 to 64"),
        ({"load_n_per_m": 0}, "positive"),
        ({"inertia_m4": -1}, "positive"),
        ({"depth_m": 0}, "positive"),
        ({"span_m": float("nan")}, "positive"),
    ],
)
def test_invalid_beam_inputs_raise(kwargs, match):
    with pytest.raises(ValueError, match=match):
        _solve(**kwargs)
