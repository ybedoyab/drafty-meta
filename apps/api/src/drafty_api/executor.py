"""Isolated job process. The HTTP request that created the job does not wait for it."""

import argparse
import json
import shutil
import traceback
from pathlib import Path

from drafty_api.jobs import update_job
from drafty_api.settings import settings
from drafty_api.storage import sync_job
from drafty_engineering.errors import Cancelled, DraftyError
from drafty_engineering.optimize import optimize_thickness
from drafty_engineering.pipeline import run_simulation
from drafty_engineering.spec import DesignSpec


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--job-dir", required=True)
    args = parser.parse_args()
    directory = Path(args.job_dir)
    job = json.loads((directory / "job.json").read_text(encoding="utf-8"))
    cancel_file = directory / "cancel"

    def on_status(stage: str, message: str) -> None:
        if cancel_file.exists():
            raise Cancelled("The job was cancelled.")
        update_job(directory, status=stage, message=message, error=None)

    try:
        spec = DesignSpec.model_validate(job["spec"])
        if job["kind"] == "optimization":
            result = _optimize(directory, spec, job, on_status, cancel_file)
        elif settings.drafty_compute == "modal":
            on_status("solving", "Waiting for Modal")
            result = _run_modal(spec)
            (directory / "results.json").write_text(json.dumps(result), encoding="utf-8")
        else:
            result = run_simulation(spec, directory, on_status, cancel_file)
        summary = _summary(result, job["kind"])
        update_job(directory, status="completed", message="Completed", error=None, summary=summary)
        _sync(directory)
    except Cancelled as exc:
        update_job(directory, status="cancelled", message="Cancelled", error=str(exc))
    except Exception as exc:
        traceback.print_exc()
        message = str(exc) if isinstance(exc, DraftyError) else f"{exc.__class__.__name__}: {exc}"
        update_job(directory, status="failed", message="Failed", error=message)
        _sync(directory)


def _optimize(directory: Path, spec: DesignSpec, job: dict, on_status, cancel_file: Path) -> dict:
    options = job.get("options") or {}
    proposer = _meta_proposer()
    result = optimize_thickness(
        spec,
        directory,
        lower_m=float(options["lower_m"]),
        upper_m=float(options["upper_m"]),
        min_safety_factor=float(options.get("min_safety_factor", 2.0)),
        max_displacement_m=options.get("max_displacement_m"),
        max_iterations=int(options.get("max_iterations", 4)),
        on_status=on_status,
        cancel_file=cancel_file,
        proposer=proposer,
    )
    (directory / "optimization.json").write_text(json.dumps(result), encoding="utf-8")
    best = result.get("best")
    if best and best.get("artifact_dir"):
        source = directory / best["artifact_dir"] / "results.json"
        if source.exists():
            shutil.copy(source, directory / "results.json")
    return result


def _meta_proposer():
    if not settings.meta_configured:
        return None

    def propose(history: list[dict], lower: float, upper: float) -> float | None:
        from drafty_ai.agent import propose_next_thickness
        from drafty_ai.client import MetaNotConfigured, MetaRequestError

        try:
            return propose_next_thickness(history, lower, upper)
        except (MetaNotConfigured, MetaRequestError, KeyError, ValueError, json.JSONDecodeError):
            return None

    return propose


def _run_modal(spec: DesignSpec) -> dict:
    if not settings.modal_configured:
        raise DraftyError(
            "DRAFTY_COMPUTE=modal but MODAL_TOKEN_ID or MODAL_TOKEN_SECRET is empty. No local solver was started."
        )
    import modal

    function = modal.Function.from_name("drafty-engineering", "run_simulation")
    call = function.spawn(spec.model_dump(mode="json"))
    result = call.get(timeout=settings.drafty_solver_timeout_s)
    if not isinstance(result, dict) or "solver" not in result:
        raise DraftyError("Modal returned a payload that is not a CalculiX result.")
    return result


def _summary(result: dict, kind: str) -> dict:
    if kind == "optimization":
        best = result.get("best") or {}
        return {
            "mass_kg": best.get("mass_kg"),
            "max_displacement_m": best.get("displacement_m"),
            "safety_factor": best.get("safety_factor"),
            "validation_status": best.get("validation_status"),
            "iterations": len(result.get("iterations") or []),
        }
    return {
        "mass_kg": result.get("mass_kg"),
        "max_displacement_m": result.get("max_displacement_m"),
        "safety_factor": result.get("safety_factor"),
        "validation_status": result.get("validation_status"),
        "governing_von_mises_pa": result.get("governing_von_mises_pa"),
    }


def _sync(directory: Path) -> None:
    try:
        sync_job(directory)
    except Exception as exc:
        with (directory / "worker.log").open("a", encoding="utf-8") as handle:
            handle.write(f"Supabase sync failed: {exc}\n")


if __name__ == "__main__":
    main()
