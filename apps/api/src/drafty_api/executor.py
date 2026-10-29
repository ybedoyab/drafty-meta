"""Isolated job process. The HTTP request that created the job does not wait for it."""

import argparse
import json
import os
import shutil
import threading
import time
import traceback
from pathlib import Path

from drafty_api.jobs import acquire_claim, touch_claim, update_job
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
    execute(Path(args.job_dir))


def execute(directory: Path) -> None:
    if not acquire_claim(directory):
        return
    stop = threading.Event()

    def beat() -> None:
        while not stop.wait(2):
            try:
                touch_claim(directory)
                update_job(directory, heartbeat_at=_utc(), worker_pid=os.getpid())
            except Exception:
                return

    thread = threading.Thread(target=beat, daemon=True)
    thread.start()
    try:
        _run(directory)
    finally:
        stop.set()
        touch_claim(directory)


def _run(directory: Path) -> None:
    job = json.loads((directory / "job.json").read_text(encoding="utf-8"))
    cancel_file = directory / "cancel"

    def on_status(stage: str, message: str) -> None:
        if cancel_file.exists():
            raise Cancelled("The job was cancelled.")
        touch_claim(directory)
        update_job(directory, status=stage, message=message, error=None, heartbeat_at=_utc())

    try:
        spec = DesignSpec.model_validate(job["spec"])
        backend = job.get("compute") or settings.drafty_compute or "local"
        if job["kind"] == "optimization":
            result = _optimize(directory, spec, job, on_status, cancel_file)
        elif backend == "modal":
            on_status("solving", "Waiting for Modal CalculiX")
            result = _run_modal(directory, spec, job, cancel_file)
        else:
            result = run_simulation(spec, directory, on_status, cancel_file)
        summary = _summary(result, job["kind"])
        update_job(
            directory,
            status="completed",
            message="Completed",
            error=None,
            summary=summary,
            compute=backend,
            artifact_storage="local",
            heartbeat_at=_utc(),
        )
        stored = _sync(directory)
        if stored != "local":
            update_job(directory, artifact_storage=stored)
    except Cancelled as exc:
        update_job(directory, status="cancelled", message="Cancelled", error=str(exc))
    except Exception as exc:
        traceback.print_exc()
        message = str(exc) if isinstance(exc, DraftyError) else f"{exc.__class__.__name__}: {exc}"
        update_job(directory, status="failed", message="Failed", error=message)
        _sync(directory)


def _utc() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


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
        source_dir = directory / best["artifact_dir"]
        for name in ("results.json", "model.step", "model.dat", "model.frd", "preview.glb", "results.glb", "model.inp"):
            source = source_dir / name
            if source.exists():
                shutil.copy(source, directory / name)
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


def _run_modal(directory: Path, spec: DesignSpec, job: dict, cancel_file: Path) -> dict:
    if not settings.modal_available:
        raise DraftyError("Modal Cloud CalculiX is not configured. No local solver was started.")
    import modal

    from drafty_engineering.artifacts import ARTIFACT_NAMES, MAX_ARTIFACT_BYTES, verify_manifest

    function_name = "optimize_design" if job.get("kind") == "optimization" else "run_simulation"
    function = modal.Function.from_name("drafty-engineering", function_name)
    call_id = job.get("modal_call_id")
    if call_id:
        call = modal.FunctionCall.from_id(str(call_id))
    elif job.get("kind") == "optimization":
        call = function.spawn(spec.model_dump(mode="json"), job["id"], job.get("options") or {}, None)
    else:
        call = function.spawn(spec.model_dump(mode="json"), job["id"], None)
    if not call_id:
        call_id = getattr(call, "object_id", None)
        if not call_id:
            raise DraftyError("Modal did not return a FunctionCall id.")
        update_job(directory, modal_call_id=str(call_id))
    deadline = time.monotonic() + settings.drafty_solver_timeout_s
    payload = None
    while time.monotonic() < deadline:
        if cancel_file.exists():
            _cancel_modal(call)
            raise Cancelled("The Modal job was cancelled.")
        try:
            payload = call.get(timeout=5)
            break
        except TimeoutError:
            continue
        except Exception as exc:
            if exc.__class__.__name__ in {"TimeoutError", "FunctionTimeoutError"}:
                continue
            raise
    if payload is None:
        _cancel_modal(call)
        raise DraftyError("Modal exceeded the solver timeout. The remote call was cancelled.")
    if not isinstance(payload, dict) or not payload.get("manifest"):
        raise DraftyError("Modal returned a payload without an artifact manifest.")
    manifest = payload["manifest"]
    on_transfer = directory
    update_job(on_transfer, status="transferring", message="Copying Modal artifacts", heartbeat_at=_utc())
    _download_modal_artifacts(str(job["id"]), directory, manifest, ARTIFACT_NAMES, MAX_ARTIFACT_BYTES)
    verify_manifest(directory, manifest, str(job["id"]))
    results_path = directory / "results.json"
    if not results_path.is_file():
        raise DraftyError("Modal finished without results.json.")
    result = json.loads(results_path.read_text(encoding="utf-8"))
    if not isinstance(result, dict) or "solver" not in result:
        raise DraftyError("The transferred results.json is not a CalculiX result.")
    result["compute"] = "modal"
    return result


def _cancel_modal(call: object) -> None:
    cancel = getattr(call, "cancel", None)
    if cancel is None:
        return
    try:
        cancel()
    except Exception:
        return


def _download_modal_artifacts(
    job_id: str,
    directory: Path,
    manifest: list[dict],
    allowed: tuple[str, ...],
    limit: int,
) -> None:
    import modal

    volume = modal.Volume.from_name("drafty-artifacts")
    for item in manifest:
        name = str(item.get("name") or "")
        if name not in allowed:
            raise DraftyError("Modal listed an artifact name that is not allowed.")
        temporary = directory / f".{name}.partial"
        received = 0
        try:
            with temporary.open("wb") as handle:
                for chunk in volume.read_file(f"{job_id}/{name}"):
                    received += len(chunk)
                    if received > limit:
                        raise DraftyError(f"{name} exceeds the artifact size limit.")
                    handle.write(chunk)
        except Exception:
            temporary.unlink(missing_ok=True)
            raise
        temporary.replace(directory / name)


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


def _sync(directory: Path) -> str:
    try:
        uploaded = sync_job(directory)
    except Exception as exc:
        with (directory / "worker.log").open("a", encoding="utf-8") as handle:
            handle.write(f"Supabase sync failed: {type(exc).__name__}\n")
        return "local"
    return "supabase" if uploaded else "local"


if __name__ == "__main__":
    main()
