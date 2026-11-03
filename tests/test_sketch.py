import pytest
from pydantic import ValidationError

from drafty_engineering.cad import build_solid, cad_matches_spec, solid_volume
from drafty_engineering.geometry_math import envelope, expected_face_area
from drafty_engineering.openscad_export import to_openscad
from drafty_engineering.spec import DesignSpec, cantilever_benchmark_spec

ROOF = [
    {"u": 0.0, "v": 0.0},
    {"u": 1.0, "v": 0.0},
    {"u": 0.5, "v": 1.0},
]


def _roof_spec(**overrides):
    payload = cantilever_benchmark_spec().model_dump()
    payload["additions"] = [
        {
            "label": "Roof",
            "face": "zmax",
            "profile": ROOF,
            "width_m": 0.2,
            "height_m": 0.05,
            "depth_m": 0.012,
            **overrides,
        }
    ]
    return DesignSpec.model_validate(payload)


def test_roof_addition_sizes_and_volume():
    spec = _roof_spec()
    addition = spec.additions[0]
    assert addition.profile_area_m2() == pytest.approx(0.5 * 0.2 * 0.05)
    bounds = envelope(spec)
    # Beam top is z=0.006; the roof rises 50 mm above it, centred in Y.
    assert bounds.zmax == pytest.approx(0.056)
    assert bounds.ymax == pytest.approx(0.01)
    assert bounds.volume_m3 == pytest.approx(0.3 * 0.02 * 0.012 + addition.volume_m3())


def test_addition_on_support_or_load_face_is_rejected():
    with pytest.raises(ValidationError, match="support or load face"):
        _roof_spec(face="xmin")


def test_addition_touching_face_edge_is_rejected():
    with pytest.raises(ValidationError, match="inside the edges"):
        _roof_spec(width_m=0.3)


def test_self_crossing_profile_is_rejected():
    payload = cantilever_benchmark_spec().model_dump()
    payload["additions"] = [
        {
            "label": "Bowtie",
            "face": "zmax",
            "profile": [
                {"u": 0.0, "v": 0.0},
                {"u": 1.0, "v": 1.0},
                {"u": 1.0, "v": 0.0},
                {"u": 0.0, "v": 1.0},
            ],
            "width_m": 0.1,
            "height_m": 0.05,
            "depth_m": 0.01,
        }
    ]
    with pytest.raises(ValidationError, match="crosses itself"):
        DesignSpec.model_validate(payload)


def test_sketch_only_part_is_valid_and_stands_on_zmin():
    spec = DesignSpec.model_validate(
        {
            "name": "sketch-roof",
            "kind": "sketch_prism",
            "material_id": "steel_s235",
            "mesh_size_m": 0.004,
            "supports": [{"surface": "ymin"}],
            "loads": [
                {
                    "surface": "ymax",
                    "mode": "force",
                    "magnitude": 50,
                    "direction": {"x": 0, "y": 0, "z": -1},
                }
            ],
            "additions": [
                {
                    "label": "Roof",
                    "face": "zmax",
                    "profile": ROOF,
                    "width_m": 0.12,
                    "height_m": 0.06,
                    "depth_m": 0.04,
                }
            ],
        }
    )
    bounds = envelope(spec)
    assert (bounds.xmin, bounds.xmax, bounds.zmin, bounds.zmax) == pytest.approx((-0.06, 0.06, 0.0, 0.06))
    assert expected_face_area(spec, "ymin") == pytest.approx(spec.additions[0].profile_area_m2())
    assert "polyhedron" in to_openscad(spec)


def test_sketch_only_part_requires_one_piece():
    payload = cantilever_benchmark_spec().model_dump()
    payload.update({"kind": "sketch_prism", "beam": None, "additions": []})
    with pytest.raises(ValidationError):
        DesignSpec.model_validate(payload)


@pytest.mark.mesh
def test_roof_addition_meshes_and_faces_still_match(tmp_path):
    from drafty_engineering.cad import export_step
    from drafty_engineering.geometry_math import expected_face_area
    from drafty_engineering.mesh import mesh_step, tetra_cells
    from drafty_engineering.solver import measure_surface_area, select_surface_nodes

    spec = _roof_spec()
    step = tmp_path / "model.step"
    export_step(build_solid(spec), step)
    mesh = mesh_step(step, tmp_path / "model.msh", spec)
    points, cells, _cell_type = tetra_cells(mesh, spec.element_order)
    assert len(cells) > 0
    fixed = select_surface_nodes(points, spec, "xmin")
    loaded = select_surface_nodes(points, spec, "xmax")
    assert len(fixed) > 0 and len(loaded) > 0
    assert measure_surface_area(points, cells, fixed) == pytest.approx(expected_face_area(spec, "xmin"), rel=0.03)
    assert measure_surface_area(points, cells, loaded) == pytest.approx(expected_face_area(spec, "xmax"), rel=0.03)


@pytest.mark.cad
def test_roof_addition_cad_volume_matches_envelope():
    spec = _roof_spec()
    solid = build_solid(spec)
    volume = solid_volume(solid)
    cad_matches_spec(spec, volume)
    assert volume == pytest.approx(envelope(spec).volume_m3, rel=1e-3)
    bounds = solid.val().BoundingBox()
    assert bounds.zmax == pytest.approx(envelope(spec).zmax, abs=1e-6)


@pytest.mark.cad
def test_sketch_only_cad_volume_matches_envelope():
    spec = _roof_spec()
    payload = {
        "name": "sketch-roof",
        "kind": "sketch_prism",
        "material_id": "steel_s235",
        "mesh_size_m": 0.004,
        "supports": [{"surface": "ymin"}],
        "loads": [
            {"surface": "ymax", "mode": "force", "magnitude": 50, "direction": {"x": 0, "y": 0, "z": -1}}
        ],
        "additions": [
            {"label": "Roof", "face": "zmax", "profile": ROOF, "width_m": 0.12, "height_m": 0.06, "depth_m": 0.04}
        ],
    }
    standalone = DesignSpec.model_validate(payload)
    assert spec is not None
    volume = solid_volume(build_solid(standalone))
    assert volume == pytest.approx(envelope(standalone).volume_m3, rel=1e-3)
