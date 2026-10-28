"""Closed-form beam checks. These never replace solver output."""

import math

BENCHMARK_LENGTH_M = 0.300
BENCHMARK_WIDTH_M = 0.020
BENCHMARK_HEIGHT_M = 0.012
BENCHMARK_FORCE_N = 100.0
BENCHMARK_MESH_M = 0.006

# Agreed before looking at solver output.
DEFLECTION_TOLERANCE = 0.08
STRESS_TOLERANCE = 0.20
RECTANGULAR_SHEAR_FACTOR = 1.2


def second_moment_area(width_m: float, height_m: float) -> float:
    return width_m * height_m**3 / 12.0


def tip_deflection_components(
    force_n: float,
    length_m: float,
    youngs_modulus_pa: float,
    poisson_ratio: float,
    width_m: float,
    height_m: float,
) -> tuple[float, float]:
    """Euler-Bernoulli bending plus Timoshenko shear for a tip force.

    The shear coefficient is 6/5 for a rectangular cross-section.
    """

    inertia = second_moment_area(width_m, height_m)
    bending_m = force_n * length_m**3 / (3.0 * youngs_modulus_pa * inertia)
    shear_modulus = youngs_modulus_pa / (2.0 * (1.0 + poisson_ratio))
    area = width_m * height_m
    shear_m = RECTANGULAR_SHEAR_FACTOR * force_n * length_m / (shear_modulus * area)
    return bending_m, shear_m


def bending_stress_pa(
    force_n: float,
    length_m: float,
    width_m: float,
    height_m: float,
    x_from_root_m: float,
) -> float:
    """Outer-fiber bending stress at a station measured from the fixed root."""

    moment = force_n * (length_m - x_from_root_m)
    inertia = second_moment_area(width_m, height_m)
    return moment * (height_m / 2.0) / inertia


def von_mises_pa(stress: list[float] | tuple[float, ...]) -> float:
    sxx, syy, szz, sxy, syz, szx = stress
    return math.sqrt(0.5 * ((sxx - syy) ** 2 + (syy - szz) ** 2 + (szz - sxx) ** 2 + 6.0 * (sxy**2 + syz**2 + szx**2)))
