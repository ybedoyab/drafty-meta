"""Modal worker for isolated CalculiX jobs.

Deploy from the repository root after `modal setup` or server tokens are present:

    modal deploy infra/modal/app.py

The HTTP API never waits for this function. The local worker spawns it, stores the
FunctionCall id, and copies artifacts off the volume before the container exits.
Supabase credentials are not installed in this image.
"""

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
    )
    .add_local_python_source("drafty_engineering")
)

app = modal.App("drafty-engineering")
volume = modal.Volume.from_name("drafty-artifacts", create_if_missing=True)


@app.function(
    image=image,
    cpu=2.0,
    memory=4096,
    timeout=900,
    max_containers=1,
    volumes={"/artifacts": volume},
)
def run_simulation(spec: dict, job_id: str) -> dict:
    from drafty_engineering.artifacts import build_manifest
    from drafty_engineering.pipeline import run_simulation as simulate
    from drafty_engineering.spec import DesignSpec

    if not re.fullmatch(r"[0-9a-fA-F-]{36}", job_id):
        raise ValueError("The job id is not a UUID.")
    work = Path("/artifacts") / job_id
    work.mkdir(parents=True, exist_ok=True)
    result = simulate(DesignSpec.model_validate(spec), work)
    manifest = build_manifest(work, job_id)
    volume.commit()
    return {
        "solver": result.get("solver"),
        "mass_kg": result.get("mass_kg"),
        "max_displacement_m": result.get("max_displacement_m"),
        "validation_status": result.get("validation_status"),
        "manifest": manifest,
        "artifact_storage": "modal-volume",
    }
