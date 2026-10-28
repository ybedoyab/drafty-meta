import pytest

from drafty_engineering.cad import build_solid, cad_matches_spec, solid_volume
from drafty_engineering.geometry_math import envelope
from drafty_engineering.spec import bracket_spec, cantilever_benchmark_spec, perforated_plate_spec, plate_spec


@pytest.mark.cad
@pytest.mark.parametrize(
    "spec_factory",
    [cantilever_benchmark_spec, plate_spec, bracket_spec, perforated_plate_spec],
)
def test_cad_volume_matches_the_design(spec_factory):
    spec = spec_factory()
    solid = build_solid(spec)
    volume = solid_volume(solid)
    cad_matches_spec(spec, volume)
    assert volume == pytest.approx(envelope(spec).volume_m3, rel=1e-3)
    bounds = solid.val().BoundingBox()
    expected = envelope(spec)
    assert bounds.xmin == pytest.approx(expected.xmin, abs=1e-8)
    assert bounds.xmax == pytest.approx(expected.xmax, abs=1e-6)
    assert bounds.zmin == pytest.approx(expected.zmin, abs=1e-6)
    assert bounds.zmax == pytest.approx(expected.zmax, abs=1e-6)
