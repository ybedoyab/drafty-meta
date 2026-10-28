"""Regression tests for the bracket stress sample and support-force balance."""

import numpy as np
import pytest

from drafty_engineering.optimize import _is_feasible
from drafty_engineering.pipeline import exclusion_distance_m
from drafty_engineering.solver import support_equilibrium
from drafty_engineering.spec import (
    BracketGeometry,
    DesignSpec,
    Direction,
    Load,
    Support,
)


def _wall_loaded_bracket() -> DesignSpec:
    return DesignSpec(
        name="aluminum-bracket",
        kind="l_bracket",
        material_id="aluminum_6061_t6",
        mesh_size_m=0.0024,
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


def test_shared_edge_load_is_added_back_into_the_support_force():
    applied = np.array([0.0, 0.0, -200.0])
    on_support = np.array([0.0, 0.0, -8.14217508223])
    printed = np.array([8.486213590938596e-07, 6.612334835578992e-08, 191.8578250700796])
    report = support_equilibrium(applied, on_support, printed)
    naive = float(np.linalg.norm(printed + applied) / 200.0)
    assert naive == pytest.approx(0.04071087, rel=1e-4)
    assert report["passed"] is True
    assert report["relative_residual"] < 1e-6
    assert report["reaction_force_n"][2] == pytest.approx(200.0, abs=1e-4)


def test_exclusion_keeps_the_loaded_wall_instead_of_the_unloaded_foot():
    spec = _wall_loaded_bracket()
    points = np.array(
        [
            [0.001, 0.0, 0.080],
            [0.007, 0.0, 0.080],
            [0.050, 0.0, 0.004],
        ]
    )
    loaded = np.array([0, 1])
    distance = exclusion_distance_m(spec, points, loaded)
    old_band = 1.5 * spec.bracket.thickness_m
    assert points[1, 0] < old_band
    assert distance < spec.bracket.thickness_m
    assert points[1, 0] >= distance
    assert points[0, 0] < distance


def test_a_near_zero_governing_sample_cannot_make_a_design_feasible():
    result = {
        "validation_status": "solver_completed",
        "safety_factor": 1.2e7,
        "equilibrium": {"passed": True},
        "stress_assessment": {"reliable": False, "safety_factor_status": "unreliable"},
    }
    reliable = result["stress_assessment"]["reliable"] is True
    assert reliable is False
    assert (reliable and _is_feasible(result, 2.0, 1.3e-7, 0.001)) is False


def test_force_balance_failure_is_not_feasible():
    result = {
        "validation_status": "solver_completed",
        "safety_factor": 4.0,
        "equilibrium": {"passed": False},
    }
    assert _is_feasible(result, 1.5, 0.001, None) is False
