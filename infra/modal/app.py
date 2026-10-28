"""Modal worker for isolated CalculiX jobs.

Deploy from the repository root after the tokens are in the environment:

    modal deploy infra/modal/app.py

The API calls the deployed function only when DRAFTY_COMPUTE=modal.
"""

import tempfile
from pathlib import Path

import modal

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install(
        "calculix-ccx",
        "libgl1",
        "libglu1-mesa",
        "libglib2.0-0",
        "libxrender1",
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


@app.function(image=image, cpu=2.0, memory=4096, timeout=900, max_containers=4)
def run_simulation(spec: dict) -> dict:
    from drafty_engineering.pipeline import run_simulation as simulate
    from drafty_engineering.spec import DesignSpec

    with tempfile.TemporaryDirectory(prefix="drafty-modal-") as directory:
        result = simulate(DesignSpec.model_validate(spec), Path(directory))
    result["artifact_storage"] = "modal-result"
    return result
