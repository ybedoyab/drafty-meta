"""Bounded thickness search. Every accepted design comes from a completed solve."""

import shutil
from collections.abc import Callable
from pathlib import Path

from pydantic import ValidationError

from drafty_engineering.errors import Cancelled, DraftyError
from drafty_engineering.pipeline import run_simulation
from drafty_engineering.spec import DesignSpec

Proposer = Callable[[list[dict], float, float], float | None]


def optimize_thickness(
    spec: DesignSpec,
    workdir: Path,
    lower_m: float,
    upper_m: float,
    min_safety_factor: float,
    max_displacement_m: float | None,
    max_iterations: int,
    on_status=None,
    cancel_file: Path | None = None,
    proposer: Proposer | None = None,
) -> dict:
    if upper_m <= lower_m:
        raise DraftyError("The upper thickness bound must be larger than the lower bound.")
    if not 1 <= max_iterations <= 6:
        raise DraftyError("Optimization is limited to between 1 and 6 finite element iterations.")
    workdir.mkdir(parents=True, exist_ok=True)
    iterations: list[dict] = []
    best: dict | None = None
    low = lower_m
    high = upper_m
    for index in range(max_iterations):
        if cancel_file is not None and cancel_file.exists():
            raise Cancelled("The optimization was cancelled.")
        fallback = (low + high) / 2.0
        sample = fallback
        source = "bisection"
        submitted = _current_thickness(spec)
        if index == 0 and submitted is not None and lower_m <= submitted <= upper_m:
            sample = submitted
            source = "submitted"
        elif proposer is not None:
            idea = proposer(iterations, low, high)
            if idea is not None and low <= idea <= high:
                sample = float(idea)
                source = "meta"
            elif idea is not None:
                iterations.append(
                    {
                        "index": index,
                        "source": "meta",
                        "thickness_m": float(idea),
                        "accepted": False,
                        "feasible": False,
                        "error": "The proposal was outside the thickness bounds, so it was not solved.",
                    }
                )
        iteration_dir = workdir / f"iteration-{index:02d}"
        if iteration_dir.exists():
            shutil.rmtree(iteration_dir)
        try:
            candidate = _with_thickness(spec, sample)
        except (ValidationError, ValueError) as exc:
            iterations.append(
                {
                    "index": index,
                    "source": source,
                    "thickness_m": sample,
                    "accepted": False,
                    "feasible": False,
                    "error": str(exc),
                }
            )
            continue
        if on_status is not None:
            on_status("solving", f"Iteration {index + 1} of {max_iterations}")

        def stage(name: str, message: str, *, iteration: int = index) -> None:
            if on_status is not None:
                on_status(name, f"Iteration {iteration + 1} of {max_iterations}: {message}")

        try:
            result = run_simulation(candidate, iteration_dir, stage, cancel_file)
        except DraftyError as exc:
            iterations.append(
                {
                    "index": index,
                    "source": source,
                    "thickness_m": sample,
                    "accepted": False,
                    "feasible": False,
                    "error": str(exc),
                }
            )
            if source == "bisection":
                low = sample
            continue
        displacement = _reported_displacement(candidate, result)
        feasible = _is_feasible(result, min_safety_factor, displacement, max_displacement_m)
        record = {
            "index": index,
            "source": source,
            "thickness_m": sample,
            "mass_kg": result["mass_kg"],
            "displacement_m": displacement,
            "safety_factor": result["safety_factor"],
            "governing_von_mises_pa": result["governing_von_mises_pa"],
            "max_von_mises_pa": result["max_von_mises_pa"],
            "validation_status": result["validation_status"],
            "safety_factor_status": (result.get("stress_assessment") or {}).get("safety_factor_status", "exploratory"),
            "feasible": feasible,
            "accepted": False,
            "artifact_dir": iteration_dir.name,
        }
        iterations.append(record)
        if feasible and (best is None or record["mass_kg"] < best["mass_kg"]):
            best = record
            record["accepted"] = True
            for earlier in iterations[:-1]:
                earlier["accepted"] = False
        if feasible:
            high = min(high, sample)
        else:
            low = max(low, sample)
    summary = {
        "variable": _variable_name(spec),
        "lower_m": lower_m,
        "upper_m": upper_m,
        "min_safety_factor": min_safety_factor,
        "max_displacement_m": max_displacement_m,
        "iterations": iterations,
        "best": best,
        "submitted": next((item for item in iterations if item.get("source") == "submitted"), None),
        "optimality": "Bounded one-dimensional search. Not a proof of a global optimum.",
        "safety_basis": "exploratory governing von Mises, not a certified safety factor",
        "units": {"length": "m", "mass": "kg", "stress": "Pa"},
    }
    if best is None:
        summary["message"] = "No solved iteration met the safety factor and displacement limits."
    elif best.get("validation_status") != "benchmark_passed":
        summary["message"] = (
            "The accepted iteration finished in CalculiX. Its factor uses the exploratory governing stress "
            "and is not a closed-form benchmark."
        )
    return summary


def _current_thickness(spec: DesignSpec) -> float | None:
    if spec.kind == "cantilever_beam" and spec.beam:
        return spec.beam.height_m
    if spec.kind == "l_bracket" and spec.bracket:
        return spec.bracket.thickness_m
    if spec.plate:
        return spec.plate.thickness_m
    return None


def _with_thickness(spec: DesignSpec, thickness_m: float) -> DesignSpec:
    payload = spec.model_dump()
    if spec.kind == "cantilever_beam" and spec.beam:
        payload["beam"]["height_m"] = thickness_m
    elif spec.kind in {"plate", "perforated_plate"} and spec.plate:
        payload["plate"]["thickness_m"] = thickness_m
    elif spec.kind == "l_bracket" and spec.bracket:
        payload["bracket"]["thickness_m"] = thickness_m
    else:
        raise DraftyError("This part has no thickness variable.")
    return DesignSpec.model_validate(payload)


def _is_feasible(
    result: dict,
    min_safety_factor: float,
    displacement: float,
    max_displacement_m: float | None,
) -> bool:
    if result.get("validation_status") == "benchmark_failed":
        return False
    if result["safety_factor"] < min_safety_factor:
        return False
    if max_displacement_m is not None and displacement > max_displacement_m:
        return False
    return True


def _variable_name(spec: DesignSpec) -> str:
    if spec.kind == "cantilever_beam":
        return "beam.height_m"
    if spec.kind == "l_bracket":
        return "bracket.thickness_m"
    return "plate.thickness_m"


def _reported_displacement(spec: DesignSpec, result: dict) -> float:
    benchmark = result.get("benchmark") or {}
    if spec.kind == "cantilever_beam" and benchmark.get("fem_tip_deflection_m") is not None:
        return abs(float(benchmark["fem_tip_deflection_m"]))
    return float(result["max_displacement_m"])
