"""Three-mesh check of the wall-loaded aluminum bracket. Not a certification."""

import pytest

from drafty_engineering.pipeline import run_simulation
from drafty_engineering.spec import BracketGeometry, DesignSpec, Direction, Load, Support


def _bracket(mesh_size_m: float) -> DesignSpec:
    return DesignSpec(
        name="aluminum-bracket",
        kind="l_bracket",
        material_id="aluminum_6061_t6",
        mesh_size_m=mesh_size_m,
        element_order=2,
        supports=[Support(surface="xmin")],
        loads=[
            Load(
                surface="zmax",
                mode="force",
                magnitude=200.0,
                direction=Direction(x=0.0, y=0.0, z=-1.0),
            )
        ],
        bracket=BracketGeometry(leg_x_m=0.080, leg_z_m=0.080, thickness_m=0.008, width_m=0.040),
    )


@pytest.mark.fem
@pytest.mark.parametrize("mesh_size_m", [0.005, 0.004, 0.003])
def test_wall_loaded_bracket_keeps_a_usable_stress_sample(mesh_size_m, tmp_path):
    result = run_simulation(_bracket(mesh_size_m), tmp_path)
    assessment = result["stress_assessment"]
    assert result["equilibrium"]["passed"] is True
    assert result["equilibrium"]["reaction_force_n"][2] == pytest.approx(200.0, rel=1e-3, abs=0.05)
    assert result["mass_kg"] == pytest.approx(0.131328, rel=0.02)
    assert result["max_von_mises_pa"] > assessment["measure_pa"]
    assert assessment["reliable"] is True
    assert assessment["safety_factor_status"] == "exploratory"
    assert result["quality_gates"]["validated_feasibility"] is False
    assert result["max_displacement_m"] > 0
