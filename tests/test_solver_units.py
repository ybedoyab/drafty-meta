import numpy as np
import pytest

from drafty_engineering.mesh import order_tetra10
from drafty_engineering.solver import parse_dat, parse_frd_nodal


def test_quadratic_tet_nodes_are_reordered_to_calculix():
    points = np.array(
        [
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
            [0.5, 0.0, 0.0],
            [0.5, 0.5, 0.0],
            [0.0, 0.5, 0.0],
            [0.0, 0.0, 0.5],
            [0.5, 0.0, 0.5],
            [0.0, 0.5, 0.5],
        ]
    )
    scrambled = np.array([0, 1, 2, 3, 9, 8, 7, 6, 5, 4])
    assert list(order_tetra10(points, scrambled)) == list(range(10))


def test_frd_parser_reads_jammed_negative_values():
    text = """
 -4  DISP        4    1
 -1         1 0.00000E+00 0.00000E+00-1.00000E-03
 -3
 -4  STRESS      6    1
 -1         1-6.78719E+07-2.23996E+07-2.02167E+07-1.34983E+07-2.63640E+06-5.37512E+05
 -3
"""
    displacements, stresses = parse_frd_nodal(text)
    assert displacements[1][2] == pytest.approx(-1e-3)
    assert stresses[1][0] == pytest.approx(-6.78719e7)
    assert len(stresses[1]) == 6


def test_dat_parser_reads_displacements_and_stress():
    text = """
 displacements (vx,vy,vz) for set NALL and time  1.000000E+00

      1   0.000000E+00   0.000000E+00  -1.000000E-03
      2   1.000000E-04   0.000000E+00  -2.000000E-03

 stresses (elem, integ.pnt.,sxx,syy,szz,sxy,syz,szx) for set EALL and time  1.000000E+00

      1   1   1.000000E+07   0.000000E+00   0.000000E+00   0.000000E+00   0.000000E+00   0.000000E+00
      1   2   3.000000E+07   0.000000E+00   0.000000E+00   0.000000E+00   0.000000E+00   0.000000E+00
"""
    displacements, stresses = parse_dat(text)
    assert displacements[2][2] == -2e-3
    assert len(stresses[1]) == 2
