"""Artifact manifests. Checksums are verified before a remote file is accepted."""

import hashlib
from pathlib import Path

from drafty_engineering.errors import DraftyError

ARTIFACT_NAMES = (
    "model.step",
    "model.inp",
    "model.dat",
    "model.frd",
    "model.msh",
    "model.vtu",
    "preview.glb",
    "results.glb",
    "results.json",
    "report.json",
    "solver.log",
    "optimization.json",
)

MAX_ARTIFACT_BYTES = 64 * 1024 * 1024


def safe_artifact_name(name: str) -> str:
    if name not in ARTIFACT_NAMES or "/" in name or "\\" in name or ".." in name:
        raise DraftyError(f"Artifact name is not allowed: {name}")
    return name


def build_manifest(directory: Path, job_id: str) -> list[dict]:
    items: list[dict] = []
    for name in ARTIFACT_NAMES:
        path = directory / name
        if not path.is_file():
            continue
        data = path.read_bytes()
        if len(data) > MAX_ARTIFACT_BYTES:
            raise DraftyError(f"{name} exceeds the artifact size limit.")
        items.append(
            {
                "name": name,
                "byte_length": len(data),
                "sha256": hashlib.sha256(data).hexdigest(),
                "job_id": job_id,
                "provenance": "calculix-workdir",
            }
        )
    return items


def verify_manifest(directory: Path, manifest: list[dict], job_id: str) -> None:
    for item in manifest:
        name = safe_artifact_name(str(item.get("name") or ""))
        if item.get("job_id") != job_id:
            raise DraftyError("Artifact manifest job id does not match this job.")
        path = directory / name
        if not path.is_file():
            raise DraftyError(f"Artifact {name} was listed but not received.")
        data = path.read_bytes()
        if len(data) != int(item["byte_length"]) or len(data) > MAX_ARTIFACT_BYTES:
            raise DraftyError(f"Artifact {name} size does not match the manifest.")
        digest = hashlib.sha256(data).hexdigest()
        if digest != item.get("sha256"):
            raise DraftyError(f"Artifact {name} checksum does not match the manifest.")
