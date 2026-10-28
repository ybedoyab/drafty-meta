import math

import pytest

from drafty_engineering.analytical import (
    bending_stress_pa,
    tip_deflection_components,
    von_mises_pa,
)


def test_textbook_cantilever_numbers():
    bending, shear = tip_deflection_components(100.0, 0.3, 210e9, 0.3, 0.02, 0.012)
    assert bending == pytest.approx(0.001488095238, rel=1e-9)
    assert shear == pytest.approx(1.857142857e-6, rel=1e-9)
    assert bending_stress_pa(100.0, 0.3, 0.02, 0.012, 0.15) == pytest.approx(31.25e6)
    assert von_mises_pa((31.25e6, 0, 0, 0, 0, 0)) == pytest.approx(31.25e6)


def test_units():
    from drafty_engineering.units import meters_to_mm, mpa_to_pascals, pascals_to_mpa

    assert meters_to_mm(0.012) == pytest.approx(12)
    assert pascals_to_mpa(31.25e6) == pytest.approx(31.25)
    assert mpa_to_pascals(235) == pytest.approx(235e6)
    assert math.isclose(mpa_to_pascals(pascals_to_mpa(1.0)), 1.0)
