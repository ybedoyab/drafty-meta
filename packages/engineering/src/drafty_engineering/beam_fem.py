"""Euler-Bernoulli elements for one simply supported prismatic beam.

Displacement is positive upward. The uniform load is positive downward.
A positive load q_up = -w uses the consistent nodal vector

    [q L / 2, q L^2 / 12, q L / 2, -q L^2 / 12].

Rotation is the slope dv/dx. Supports remove transverse displacement and
leave rotation free, so the support moment is a residual, not an input.
Shear deformation is not included. Nothing here is a CalculiX result,
a code check, or a statement that a beam is adequate.
"""

import math

import numpy as np

DEFLECTION_CHECK = 0.01
MOMENT_CHECK = 0.01
REACTION_CHECK = 1e-6
EQUILIBRIUM_CHECK = 1e-8
_STATION_COUNT = 33


def analyze_simply_supported_udl(
    *,
    load_n_per_m: float,
    span_m: float,
    youngs_modulus_pa: float,
    inertia_m4: float,
    depth_m: float,
    elements: int = 16,
    yield_strength_pa: float | None = None,
) -> dict:
    values = (load_n_per_m, span_m, youngs_modulus_pa, inertia_m4, depth_m)
    if not all(math.isfinite(value) and value > 0 for value in values):
        raise ValueError("Load, span, modulus, inertia, and depth must be positive.")
    if not isinstance(elements, int) or elements < 2 or elements > 64:
        raise ValueError("Use 2 to 64 Euler-Bernoulli elements.")
    if yield_strength_pa is not None and (not math.isfinite(yield_strength_pa) or yield_strength_pa <= 0):
        raise ValueError("Yield strength must be positive when it is supplied.")

    ei = youngs_modulus_pa * inertia_m4
    length = span_m / elements
    dof = 2 * (elements + 1)
    stiffness = np.zeros((dof, dof))
    force = np.zeros(dof)
    for index in range(elements):
        local_stiffness = _element_stiffness(length, ei)
        local_force = _element_load(length, load_n_per_m)
        addresses = [2 * index, 2 * index + 1, 2 * index + 2, 2 * index + 3]
        stiffness[np.ix_(addresses, addresses)] += local_stiffness
        force[addresses] += local_force
    fixed = (0, 2 * elements)
    free = [index for index in range(dof) if index not in fixed]
    displacement = np.zeros(dof)
    try:
        displacement[free] = np.linalg.solve(stiffness[np.ix_(free, free)], force[free])
    except np.linalg.LinAlgError as exc:
        raise ValueError("The beam system could not be solved. No result was kept.") from exc
    residual = stiffness @ displacement - force
    left_reaction = float(residual[0])
    right_reaction = float(residual[2 * elements])
    left_moment = float(residual[1])
    right_moment = float(residual[2 * elements + 1])
    applied = load_n_per_m * span_m
    equilibrium_n = left_reaction + right_reaction - applied
    equilibrium = abs(equilibrium_n) / applied

    def downward(station: float) -> float:
        return _deflection_down(displacement, span_m, elements, station)

    xs = [span_m * index / (_STATION_COUNT - 1) for index in range(_STATION_COUNT)]
    stations = []
    for station in xs:
        shear = left_reaction - load_n_per_m * station
        moment = left_reaction * station - load_n_per_m * station**2 / 2.0
        stations.append(
            {
                "x_m": station,
                "shear_n": shear,
                "moment_n_m": moment,
                "deflection_m": downward(station),
            }
        )
    midspan = downward(span_m / 2.0)
    quarter = downward(span_m / 4.0)
    analytical_mid = _analytical_deflection(load_n_per_m, span_m, ei, span_m / 2.0)
    analytical_quarter = _analytical_deflection(load_n_per_m, span_m, ei, span_m / 4.0)
    analytical_moment = load_n_per_m * span_m**2 / 8.0
    analytical_reaction = applied / 2.0
    max_moment = max(item["moment_n_m"] for item in stations)
    max_shear = max(abs(item["shear_n"]) for item in stations)
    stress = max_moment * (depth_m / 2.0) / inertia_m4
    deflection_error = _relative(midspan, analytical_mid)
    moment_error = _relative(max_moment, analytical_moment)
    reaction_error = max(
        _relative(left_reaction, analytical_reaction),
        _relative(right_reaction, analytical_reaction),
    )
    moment_scale = load_n_per_m * span_m**2
    support_moments_small = abs(left_moment) <= 1e-6 * moment_scale and abs(right_moment) <= 1e-6 * moment_scale
    passed = (
        deflection_error <= DEFLECTION_CHECK
        and moment_error <= MOMENT_CHECK
        and reaction_error <= REACTION_CHECK
        and equilibrium <= EQUILIBRIUM_CHECK
        and support_moments_small
    )
    elastic_range = "not compared"
    if yield_strength_pa is not None:
        elastic_range = "above typical yield" if stress > yield_strength_pa else "within typical yield"
    return {
        "method": "euler-bernoulli",
        "status": "benchmark_passed" if passed else "benchmark_failed",
        "passed": passed,
        "stale": False,
        "elements": elements,
        "solver": {"name": "drafty-beam-element", "formulation": "euler-bernoulli", "version": "1"},
        "mesh": {
            "elements": elements,
            "nodes": elements + 1,
            "element_type": "euler-bernoulli-hermitian",
            "free_degrees_of_freedom": len(free),
        },
        "units": {"length": "m", "force": "N", "moment": "N*m", "stress": "Pa", "deflection": "m"},
        "load_n_per_m": load_n_per_m,
        "span_m": span_m,
        "youngs_modulus_pa": youngs_modulus_pa,
        "inertia_m4": inertia_m4,
        "depth_m": depth_m,
        "left_reaction_n": left_reaction,
        "right_reaction_n": right_reaction,
        "support_moment_left_n_m": left_moment,
        "support_moment_right_n_m": right_moment,
        "max_shear_n": max_shear,
        "max_moment_n_m": max_moment,
        "midspan_deflection_m": midspan,
        "quarter_span_deflection_m": quarter,
        "max_elastic_bending_stress_pa": stress,
        "elastic_range": elastic_range,
        "analytical_midspan_deflection_m": analytical_mid,
        "analytical_quarter_span_deflection_m": analytical_quarter,
        "analytical_max_moment_n_m": analytical_moment,
        "analytical_reaction_n": analytical_reaction,
        "deflection_error": deflection_error,
        "quarter_span_deflection_error": _relative(quarter, analytical_quarter),
        "moment_error": moment_error,
        "reaction_error": reaction_error,
        "equilibrium": {
            "applied_n": applied,
            "left_reaction_n": left_reaction,
            "right_reaction_n": right_reaction,
            "residual_n": equilibrium_n,
            "residual_relative": equilibrium,
        },
        "stations": stations,
        "assumptions": [
            "Euler-Bernoulli beam, prismatic, linear elastic, small deflection, no axial force.",
            "Hermitian cubic elements with the consistent nodal load for a uniform line load.",
            "Shear deformation is omitted. Timoshenko shear is not in this model.",
            "Simple supports: transverse displacement is fixed and rotation is free.",
            "Shear and moment diagrams come from the solved reactions and equilibrium.",
            "Deflection is the Hermitian interpolation of the solved nodal degrees of freedom.",
            "Outer-fiber stress is M*c/I. It is not a von Mises stress and not a solid-element stress.",
        ],
        "limitations": [
            "A match with the closed form checks this beam model. It does not certify the member.",
            "Bending and shear strength, buckling, connections, bearing, and vibration are not checked.",
            "No code combination and no serviceability limit are applied.",
            "The CalculiX solid solver is not used for this result.",
        ],
    }


def _element_stiffness(length: float, ei: float) -> np.ndarray:
    factor = ei / length**3
    return factor * np.array(
        [
            [12.0, 6.0 * length, -12.0, 6.0 * length],
            [6.0 * length, 4.0 * length**2, -6.0 * length, 2.0 * length**2],
            [-12.0, -6.0 * length, 12.0, -6.0 * length],
            [6.0 * length, 2.0 * length**2, -6.0 * length, 4.0 * length**2],
        ]
    )


def _element_load(length: float, load_n_per_m: float) -> np.ndarray:
    upward = -load_n_per_m
    return np.array(
        [
            upward * length / 2.0,
            upward * length**2 / 12.0,
            upward * length / 2.0,
            -upward * length**2 / 12.0,
        ]
    )


def _deflection_down(displacement: np.ndarray, span: float, elements: int, station: float) -> float:
    if station <= 0.0 or station >= span:
        return 0.0
    length = span / elements
    index = min(int(station / length), elements - 1)
    xi = (station - index * length) / length
    v0, t0, v1, t1 = (float(value) for value in displacement[2 * index : 2 * index + 4])
    n1 = 1.0 - 3.0 * xi**2 + 2.0 * xi**3
    n2 = length * (xi - 2.0 * xi**2 + xi**3)
    n3 = 3.0 * xi**2 - 2.0 * xi**3
    n4 = length * (-(xi**2) + xi**3)
    return -(n1 * v0 + n2 * t0 + n3 * v1 + n4 * t1)


def _analytical_deflection(load_n_per_m: float, span: float, ei: float, station: float) -> float:
    """Downward deflection of a simple span with uniform load. v(L/2) is 5 w L^4 / 384 EI."""

    return load_n_per_m * station * (span**3 - 2.0 * span * station**2 + station**3) / (24.0 * ei)


def _relative(actual: float, expected: float) -> float:
    if expected == 0:
        raise ValueError("The reference value is zero.")
    return abs(actual - expected) / abs(expected)
