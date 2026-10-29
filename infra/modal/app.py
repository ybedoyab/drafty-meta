"""Modal worker for isolated CalculiX jobs.

Deploy from the repository root after `modal setup` or server tokens are present:

    modal deploy infra/modal/app.py

The HTTP API spawns a function and returns. This image uploads allowlisted artifacts
with per-file signed URLs. It does not receive the Supabase service credential.
"""

import hashlib
import json
import re
from pathlib import Path

import modal

# Debian 13 dropped calculix-ccx. Bookworm still ships CalculiX 2.20, matching infra/docker/Dockerfile.ccx.
image = (
    modal.Image.from_registry("python:3.12-slim-bookworm")
    .apt_install(
        "calculix-ccx",
        "libgl1",
        "libglu1-mesa",
        "libglib2.0-0",
        "libgomp1",
        "libxrender1",
        "libxcursor1",
        "libxft2",
        "libxinerama1",
        "libfontconfig1",
        "libsm6",
        "libxext6",
    )
    .pip_install(
        "cadquery>=2.5",
        "gmsh>=4.13",
        "meshio>=5.3",
        "numpy>=1.26",
        "trimesh>=4.5",
        "pygltflib>=1.16",
        "pydantic>=2.10",
        "httpx>=0.27",
    )
    .add_local_python_source("drafty_engineering")
)

app = modal.App("drafty-engineering")
volume = modal.Volume.from_name("drafty-artifacts", create_if_missing=True)
_FUNCTION = dict(image=image, cpu=2.0, memory=4096, timeout=900, max_containers=1, volumes={"/artifacts": volume})

CONTENT_TYPES = {
    ".glb": "model/gltf-binary",
    ".step": "application/step",
    ".inp": "text/plain",
    ".dat": "text/plain",
    ".frd": "application/octet-stream",
    ".msh": "application/octet-stream",
    ".vtu": "application/octet-stream",
    ".json": "application/json",
    ".log": "text/plain",
}


def _uuid(job_id: str) -> None:
    if not re.fullmatch(r"[0-9a-fA-F-]{36}", job_id):
        raise ValueError("The job id is not a UUID.")


def _summary(result: dict, kind: str) -> dict:
    if kind == "optimization":
        best = result.get("best") or {}
        return {
            "mass_kg": best.get("mass_kg"),
            "max_displacement_m": best.get("max_displacement_m"),
            "validation_status": best.get("validation_status"),
            "governing_von_mises_pa": best.get("governing_von_mises_pa"),
            "safety_factor": best.get("safety_factor"),
            "iterations": len(result.get("iterations") or []),
        }
    return {
        "solver": result.get("solver"),
        "mass_kg": result.get("mass_kg"),
        "max_displacement_m": result.get("max_displacement_m"),
        "validation_status": result.get("validation_status"),
        "governing_von_mises_pa": result.get("governing_von_mises_pa"),
        "safety_factor": result.get("safety_factor"),
    }


def _promote_best(work: Path, result: dict) -> None:
    best = result.get("best") or {}
    source = best.get("artifact_dir")
    if not source:
        return
    origin = work / source
    names = (
        "results.json",
        "model.step",
        "model.dat",
        "model.frd",
        "preview.glb",
        "results.glb",
        "model.inp",
        "model.msh",
        "model.vtu",
        "solver.log",
    )
    for name in names:
        path = origin / name
        if path.is_file():
            (work / name).write_bytes(path.read_bytes())


def _deliver(work: Path, manifest: list[dict], summary: dict, delivery: dict) -> None:
    import httpx

    from drafty_engineering.artifacts import MAX_ARTIFACT_BYTES

    uploads = delivery.get("uploads") or {}
    sent: list[dict] = []
    with httpx.Client(timeout=120) as client:
        for item in manifest:
            name = item["name"]
            target = uploads.get(name) or {}
            path = work / name
            if not target.get("url") or not path.is_file():
                continue
            if path.stat().st_size > MAX_ARTIFACT_BYTES:
                raise ValueError(f"{name} exceeds the artifact size limit.")
            content_type = CONTENT_TYPES.get(path.suffix.lower(), "application/octet-stream")
            with path.open("rb") as handle:
                response = client.put(
                    target["url"],
                    content=handle,
                    headers={"Content-Type": content_type, "Authorization": f"Bearer {target.get('token', '')}"},
                )
            response.raise_for_status()
            sent.append(item)
        callback = client.post(
            delivery["callback_url"],
            json={"status": "completed", "summary": summary, "manifest": sent},
            headers={"Authorization": f"Bearer {delivery['callback_token']}"},
        )
        callback.raise_for_status()


def _finish(work: Path, job_id: str, spec: dict, kind: str, result: dict, delivery: dict | None) -> dict:
    from drafty_engineering.artifacts import build_manifest
    from drafty_engineering.report import build_report

    if kind == "optimization":
        _promote_best(work, result)
        (work / "optimization.json").write_text(json.dumps(result), encoding="utf-8")
    (work / "job.json").write_text(
        json.dumps({"id": job_id, "kind": kind, "spec": spec, "status": "completed"}),
        encoding="utf-8",
    )
    if (work / "results.json").is_file():
        (work / "report.json").write_text(json.dumps(build_report(work)), encoding="utf-8")
    manifest = build_manifest(work, job_id)
    volume.commit()
    summary = _summary(result, kind)
    storage = "modal-volume"
    if delivery:
        _deliver(work, manifest, summary, delivery)
        storage = "supabase"
    return {**summary, "manifest": manifest, "artifact_storage": storage}


def _failed(delivery: dict | None, exc: Exception) -> None:
    if not delivery:
        return
    import httpx

    public = exc.__class__.__name__ in {"DraftyError", "ValueError", "Cancelled"}
    message = str(exc) if public else exc.__class__.__name__
    try:
        httpx.post(
            delivery["callback_url"],
            json={"status": "failed", "error": message[:500]},
            headers={"Authorization": f"Bearer {delivery['callback_token']}"},
            timeout=30,
        )
    except Exception:
        return


@app.function(**_FUNCTION)
def run_simulation(spec: dict, job_id: str, delivery: dict | None = None) -> dict:
    from drafty_engineering.pipeline import run_simulation as simulate
    from drafty_engineering.spec import DesignSpec

    _uuid(job_id)
    work = Path("/artifacts") / job_id
    work.mkdir(parents=True, exist_ok=True)
    try:
        result = simulate(DesignSpec.model_validate(spec), work)
        return _finish(work, job_id, spec, "simulation", result, delivery)
    except Exception as exc:
        _failed(delivery, exc)
        raise


@app.function(**_FUNCTION)
def optimize_design(spec: dict, job_id: str, options: dict, delivery: dict | None = None) -> dict:
    from drafty_engineering.optimize import optimize_thickness
    from drafty_engineering.spec import DesignSpec

    _uuid(job_id)
    work = Path("/artifacts") / job_id
    work.mkdir(parents=True, exist_ok=True)
    parsed = DesignSpec.model_validate(spec)
    try:
        result = optimize_thickness(
            parsed,
            work,
            lower_m=float(options["lower_m"]),
            upper_m=float(options["upper_m"]),
            min_safety_factor=float(options.get("min_safety_factor", 2.0)),
            max_displacement_m=options.get("max_displacement_m"),
            max_iterations=int(options.get("max_iterations", 4)),
        )
        return _finish(work, job_id, spec, "optimization", result, delivery)
    except Exception as exc:
        _failed(delivery, exc)
        raise


@app.function(image=image, cpu=2.0, memory=4096, timeout=180, max_containers=1)
def generate_preview(spec: dict) -> bytes:
    import tempfile

    from drafty_engineering.cad import build_solid, export_preview_glb
    from drafty_engineering.spec import DesignSpec

    parsed = DesignSpec.model_validate(spec)
    with tempfile.TemporaryDirectory() as temporary:
        path = Path(temporary) / "preview.glb"
        export_preview_glb(build_solid(parsed), path, parsed.mesh_size_m)
        data = path.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if not data or len(digest) != 64:
        raise ValueError("The preview was empty.")
    return data
