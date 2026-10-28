import pytest

from drafty_engineering.materials import MATERIALS
from drafty_engineering.pipeline import run_simulation
from drafty_engineering.spec import (
    bracket_spec,
    cantilever_benchmark_spec,
    perforated_plate_spec,
    plate_spec,
)


def _scaled_beam(force_n: float, mesh_size_m: float):
    payload = cantilever_benchmark_spec(mesh_size_m).model_dump()
    payload["loads"][0]["magnitude"] = force_n
    return cantilever_benchmark_spec().model_validate(payload)


@pytest.mark.fem
def test_cantilever_benchmark_uses_calculix(tmp_path):
    result = run_simulation(cantilever_benchmark_spec(), tmp_path)
    assert result["solver"]["name"] == "calculix"
    assert "CalculiX" in result["solver"]["version"]
    assert (tmp_path / "model.frd").exists()
    assert (tmp_path / "model.dat").exists()
    assert (tmp_path / "model.step").exists()
    assert result["benchmark"]["applicable"] is True
    assert result["validation_status"] == "benchmark_passed"
    assert result["safety_factor"] > 0
    assert result["surface"]["vertices_m"]
    assert result["mass_kg"] == pytest.approx(7850 * 0.300 * 0.020 * 0.012, rel=1e-4)
    assert result["mesh"]["load_area_m2"] == pytest.approx(0.020 * 0.012, rel=0.03)
    assert any("exploratory" in warning for warning in result["warnings"])
    assert any("corner triangles" in warning for warning in result["warnings"])


@pytest.mark.fem
def test_cantilever_force_and_modulus_scale(tmp_path):
    base = run_simulation(cantilever_benchmark_spec(), tmp_path / "100n")
    doubled = run_simulation(_scaled_beam(200.0, 0.006), tmp_path / "200n")
    half = run_simulation(_scaled_beam(50.0, 0.006), tmp_path / "50n")
    base_tip = base["benchmark"]["fem_tip_deflection_m"]
    assert doubled["validation_status"] == "benchmark_passed"
    assert half["validation_status"] == "benchmark_passed"
    assert doubled["benchmark"]["fem_tip_deflection_m"] / base_tip == pytest.approx(2.0, rel=0.08)
    assert half["benchmark"]["fem_tip_deflection_m"] / base_tip == pytest.approx(0.5, rel=0.08)
    assert doubled["mass_kg"] == pytest.approx(base["mass_kg"], rel=1e-6)

    material = MATERIALS["steel_s235"]
    original = material.youngs_modulus_pa
    material.youngs_modulus_pa = original / 2.0
    try:
        soft = run_simulation(cantilever_benchmark_spec(), tmp_path / "soft")
    finally:
        material.youngs_modulus_pa = original
    assert soft["validation_status"] == "benchmark_passed"
    assert soft["benchmark"]["fem_tip_deflection_m"] / base_tip == pytest.approx(2.0, rel=0.08)


@pytest.mark.fem
def test_coarser_cantilever_mesh_stays_inside_beam_theory(tmp_path):
    result = run_simulation(cantilever_benchmark_spec(0.008), tmp_path)
    assert result["validation_status"] == "benchmark_passed"
    assert result["benchmark"]["deflection_error"] <= result["benchmark"]["deflection_tolerance"]
    assert result["benchmark"]["stress_error"] <= result["benchmark"]["stress_tolerance"]


@pytest.mark.fem
@pytest.mark.parametrize(
    "factory",
    [plate_spec, bracket_spec, perforated_plate_spec],
    ids=["plate", "l_bracket", "perforated_plate"],
)
def test_other_geometries_complete_without_a_benchmark_claim(factory, tmp_path):
    result = run_simulation(factory(), tmp_path)
    assert result["solver"]["name"] == "calculix"
    assert (tmp_path / "model.frd").exists()
    assert result["validation_status"] == "solver_completed"
    assert result["benchmark"]["applicable"] is False
    assert result["benchmark"]["passed"] is None
    assert result["max_displacement_m"] > 0
    assert result["governing_von_mises_pa"] > 0
