import pytest

from drafty_engineering.pipeline import run_simulation
from drafty_engineering.spec import cantilever_benchmark_spec


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
