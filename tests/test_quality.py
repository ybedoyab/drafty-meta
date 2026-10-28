import numpy as np
import pytest

from drafty_engineering.errors import GeometryError
from drafty_engineering.mesh import assess_mesh
from drafty_engineering.solver import parse_reaction_sum


def test_inverted_tetrahedron_is_rejected():
    points = np.array(
        [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, 2]],
        dtype=float,
    )
    cells = np.array([[0, 1, 2, 3], [0, 2, 1, 4]])
    with pytest.raises(GeometryError, match="inverted"):
        assess_mesh(points, cells)


def test_a_positive_tetrahedron_passes():
    points = np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]], dtype=float)
    cells = np.array([[0, 1, 2, 3]])
    quality = assess_mesh(points, cells)
    assert quality["inverted_elements"] == 0
    assert quality["min_corner_volume_m3"] > 0


def test_reaction_lines_sum_the_support():
    text = """
forces (fx,fy,fz) for set FIXED and time  1.000000E+00

     1  0.000000E+00  0.000000E+00  6.000000E+01
     2  0.000000E+00  0.000000E+00  4.000000E+01

displacements (vx,vy,vz) for set NALL and time  1.000000E+00
"""
    reaction = parse_reaction_sum(text)
    assert reaction[2] == pytest.approx(100)
