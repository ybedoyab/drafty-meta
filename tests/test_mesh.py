import pytest

from drafty_engineering.cad import build_solid, export_step
from drafty_engineering.geometry_math import expected_face_area
from drafty_engineering.mesh import mesh_step, tetra_cells
from drafty_engineering.solver import measure_surface_area, select_surface_nodes
from drafty_engineering.spec import cantilever_benchmark_spec


@pytest.mark.mesh
def test_beam_support_and_load_faces_match_the_design(tmp_path):
    spec = cantilever_benchmark_spec(0.008)
    step = tmp_path / "model.step"
    export_step(build_solid(spec), step)
    mesh = mesh_step(step, tmp_path / "model.msh", spec)
    points, cells, cell_type = tetra_cells(mesh, spec.element_order)
    assert cell_type == "tetra10"
    assert len(cells) > 0
    fixed = select_surface_nodes(points, spec, "xmin")
    loaded = select_surface_nodes(points, spec, "xmax")
    assert len(fixed) > 0
    assert len(set(fixed.tolist()) & set(loaded.tolist())) == 0
    support_area = measure_surface_area(points, cells, fixed)
    load_area = measure_surface_area(points, cells, loaded)
    assert support_area == pytest.approx(expected_face_area(spec, "xmin"), rel=0.03)
    assert load_area == pytest.approx(expected_face_area(spec, "xmax"), rel=0.03)
