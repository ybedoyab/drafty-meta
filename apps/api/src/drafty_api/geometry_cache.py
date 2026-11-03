"""Content-addressed geometry cache for revolved profiles.

Digests are the full SHA-256 of the canonical profile JSON. Entries are immutable:
an existing valid digest is never overwritten. Callers authorize via scenario ownership
before reading; the digest itself is not a secret.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import uuid
from pathlib import Path

from fastapi import HTTPException

from drafty_api.settings import settings
from drafty_engineering.artifacts import MAX_ARTIFACT_BYTES
from drafty_engineering.spec import RevolvedProfile

GEOMETRY_NAMES = ("model.step", "model.stl", "preview.glb")
MANIFEST_NAME = "manifest.json"


def profile_digest(profile: RevolvedProfile) -> str:
    """Stable content hash. Uses Pydantic's JSON so field order is canonical."""

    return hashlib.sha256(profile.model_dump_json().encode()).hexdigest()


def geometry_dir(digest: str) -> Path:
    if len(digest) != 64 or any(ch not in "0123456789abcdef" for ch in digest):
        raise HTTPException(status_code=500, detail="Geometry digest is invalid.")
    return settings.data_dir / "geometry" / digest


def build_manifest(files: dict[str, bytes], digest: str) -> dict:
    items = []
    for name in GEOMETRY_NAMES:
        data = files[name]
        if not data:
            raise HTTPException(status_code=502, detail=f"Geometry file {name} was empty.")
        if len(data) > MAX_ARTIFACT_BYTES:
            raise HTTPException(status_code=502, detail=f"Geometry file {name} exceeds the size limit.")
        items.append(
            {
                "name": name,
                "byte_length": len(data),
                "sha256": hashlib.sha256(data).hexdigest(),
            }
        )
    return {"digest": digest, "immutable": True, "files": items}


def verify_files(files: dict[str, bytes], manifest: dict, digest: str) -> None:
    if manifest.get("digest") != digest:
        raise HTTPException(status_code=502, detail="Geometry cache digest does not match.")
    by_name = {item["name"]: item for item in manifest.get("files") or []}
    for name in GEOMETRY_NAMES:
        item = by_name.get(name)
        data = files.get(name)
        if item is None or data is None:
            raise HTTPException(status_code=502, detail=f"Geometry cache is missing {name}.")
        if len(data) != int(item["byte_length"]) or len(data) > MAX_ARTIFACT_BYTES:
            raise HTTPException(status_code=502, detail=f"Geometry file {name} failed size checks.")
        if hashlib.sha256(data).hexdigest() != item.get("sha256"):
            raise HTTPException(status_code=502, detail=f"Geometry file {name} failed checksum.")


def read_local_cache(digest: str) -> dict[str, bytes] | None:
    directory = geometry_dir(digest)
    manifest_path = directory / MANIFEST_NAME
    if not manifest_path.is_file():
        return None
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None
    files: dict[str, bytes] = {}
    for name in GEOMETRY_NAMES:
        path = directory / name
        if not path.is_file():
            return None
        files[name] = path.read_bytes()
    try:
        verify_files(files, manifest, digest)
    except HTTPException:
        return None
    return files


def write_local_cache(digest: str, files: dict[str, bytes]) -> dict[str, bytes]:
    """Persist an immutable digest. Existing valid entries are left untouched."""

    existing = read_local_cache(digest)
    if existing is not None:
        return existing
    manifest = build_manifest(files, digest)
    directory = geometry_dir(digest)
    staging = directory.with_name(f"{directory.name}-{uuid.uuid4().hex[:8]}")
    try:
        staging.mkdir(parents=True, exist_ok=False)
        for name, data in files.items():
            (staging / name).write_bytes(data)
        (staging / MANIFEST_NAME).write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        try:
            staging.replace(directory)
        except OSError:
            shutil.rmtree(staging, ignore_errors=True)
            existing = read_local_cache(digest)
            if existing is not None:
                return existing
            raise
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    cached = read_local_cache(digest)
    if cached is None:
        raise HTTPException(status_code=502, detail="Geometry cache could not be verified after write.")
    return cached


def read_remote_cache(digest: str) -> dict[str, bytes] | None:
    from drafty_api.storage import download_private_object

    raw = download_private_object(f"geometry/{digest}/{MANIFEST_NAME}")
    if raw is None:
        return None
    try:
        manifest = json.loads(raw.decode())
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    files: dict[str, bytes] = {}
    for name in GEOMETRY_NAMES:
        data = download_private_object(f"geometry/{digest}/{name}")
        if data is None:
            return None
        files[name] = data
    try:
        verify_files(files, manifest, digest)
    except HTTPException:
        return None
    return files


def write_remote_cache(digest: str, files: dict[str, bytes]) -> None:
    """Upload once. Existing objects are not overwritten (immutable digests)."""

    from drafty_api.storage import upload_private_object_if_absent

    manifest = build_manifest(files, digest)
    upload_private_object_if_absent(
        f"geometry/{digest}/{MANIFEST_NAME}",
        json.dumps(manifest, indent=2).encode(),
        "application/json",
    )
    content_types = {
        "model.step": "model/step",
        "model.stl": "model/stl",
        "preview.glb": "model/gltf-binary",
    }
    for name, data in files.items():
        upload_private_object_if_absent(f"geometry/{digest}/{name}", data, content_types[name])


def load_or_build_geometry(profile: RevolvedProfile, owner: str) -> tuple[dict[str, bytes], bool]:
    """Return geometry files and whether this call was a cache hit.

    Cache hits never charge preview quota and never call Modal. Misses charge once,
    build (local CadQuery or Modal), then store under the full content digest.
    """

    digest = profile_digest(profile)
    local = read_local_cache(digest)
    if local is not None:
        return local, True
    if settings.production and settings.supabase_configured:
        remote = read_remote_cache(digest)
        if remote is not None:
            write_local_cache(digest, remote)
            return remote, True

    from drafty_api.jobs import charge_preview

    charge_preview(owner)
    if settings.production:
        from drafty_api.remote import remote_geometry

        files = remote_geometry(profile.model_dump())
    else:
        files = _export_local(profile)
    verify_files(files, build_manifest(files, digest), digest)
    cached = write_local_cache(digest, files)
    if settings.production and settings.supabase_configured:
        write_remote_cache(digest, cached)
    return cached, False


def _export_local(profile: RevolvedProfile) -> dict[str, bytes]:
    from drafty_engineering.cad import export_revolved
    from drafty_engineering.errors import DraftyError

    staging = geometry_dir(profile_digest(profile)).with_name(f"build-{uuid.uuid4().hex[:8]}")
    try:
        paths = export_revolved(profile, staging)
        files = {name: path.read_bytes() for name, path in paths.items()}
    except DraftyError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    finally:
        shutil.rmtree(staging, ignore_errors=True)
    return files
