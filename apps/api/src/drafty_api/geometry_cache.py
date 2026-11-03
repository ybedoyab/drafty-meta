"""Content-addressed geometry cache for revolved profiles.

Digests are SHA-256 of canonical profile JSON plus GENERATOR_REVISION so export
pipeline changes invalidate cache entries. Entries are immutable: an existing valid
digest is never overwritten. Shared geometry/ objects are never deleted with scenarios.

Publish order for remote cache: verify local bytes → upload every geometry file →
confirm each upload → publish manifest last. Incomplete uploads never publish a manifest.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import threading
import time
import uuid
from pathlib import Path

from fastapi import HTTPException

from drafty_api.settings import settings
from drafty_engineering.artifacts import MAX_ARTIFACT_BYTES
from drafty_engineering.spec import RevolvedProfile

# Bump when CadQuery export, faceting, or GLB packing changes affect bytes for the same profile.
GENERATOR_REVISION = "revolved-export-v1"

GEOMETRY_NAMES = ("model.step", "model.stl", "preview.glb")
MANIFEST_NAME = "manifest.json"
CONTENT_TYPES = {
    "model.step": "model/step",
    "model.stl": "model/stl",
    "preview.glb": "model/gltf-binary",
}

_DIGEST_LOCKS: dict[str, threading.Lock] = {}
_DIGEST_LOCKS_GUARD = threading.Lock()


def profile_digest(profile: RevolvedProfile) -> str:
    """Stable content hash including the generator revision."""

    payload = f"{profile.model_dump_json()}\0generator={GENERATOR_REVISION}"
    return hashlib.sha256(payload.encode()).hexdigest()


def geometry_dir(digest: str) -> Path:
    if len(digest) != 64 or any(ch not in "0123456789abcdef" for ch in digest):
        raise HTTPException(status_code=500, detail="Geometry digest is invalid.")
    return settings.data_dir / "geometry" / digest


def _digest_lock(digest: str) -> threading.Lock:
    with _DIGEST_LOCKS_GUARD:
        lock = _DIGEST_LOCKS.get(digest)
        if lock is None:
            lock = threading.Lock()
            _DIGEST_LOCKS[digest] = lock
        return lock


def build_manifest(files: dict[str, bytes], digest: str) -> dict:
    items = []
    for name in GEOMETRY_NAMES:
        data = files.get(name)
        if data is None or not data:
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
    return {
        "digest": digest,
        "generator_revision": GENERATOR_REVISION,
        "immutable": True,
        "files": items,
    }


def verify_files(files: dict[str, bytes], manifest: dict, digest: str) -> None:
    if manifest.get("digest") != digest:
        raise HTTPException(status_code=502, detail="Geometry cache digest does not match.")
    revision = manifest.get("generator_revision")
    if revision is not None and revision != GENERATOR_REVISION:
        raise HTTPException(status_code=502, detail="Geometry cache generator revision does not match.")
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
        for name in GEOMETRY_NAMES:
            (staging / name).write_bytes(files[name])
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
    """Upload geometry files first, verify each result, then publish the manifest.

    Rejects incomplete uploads without publishing a manifest so readers never see a
    half-written digest. Existing objects stay immutable (no upsert).
    """

    from drafty_api.storage import private_object_exists, upload_private_object_if_absent

    manifest = build_manifest(files, digest)
    verify_files(files, manifest, digest)

    existing_manifest = private_object_exists(f"geometry/{digest}/{MANIFEST_NAME}")
    if existing_manifest is True:
        # Another writer already published a complete entry.
        return

    uploaded: list[str] = []
    for name in GEOMETRY_NAMES:
        path = f"geometry/{digest}/{name}"
        ok = upload_private_object_if_absent(path, files[name], CONTENT_TYPES[name])
        if not ok:
            raise HTTPException(
                status_code=503,
                detail=f"Geometry cache upload failed for {name}. Retry the request.",
            )
        uploaded.append(name)
        exists = private_object_exists(path)
        if exists is False:
            raise HTTPException(
                status_code=503,
                detail=f"Geometry cache upload for {name} could not be verified. Retry the request.",
            )

    if len(uploaded) != len(GEOMETRY_NAMES):
        raise HTTPException(status_code=503, detail="Geometry cache upload was incomplete.")

    ok = upload_private_object_if_absent(
        f"geometry/{digest}/{MANIFEST_NAME}",
        json.dumps(manifest, indent=2).encode(),
        "application/json",
    )
    if not ok:
        raise HTTPException(
            status_code=503,
            detail="Geometry cache manifest could not be published. Retry the request.",
        )
    published = private_object_exists(f"geometry/{digest}/{MANIFEST_NAME}")
    if published is False:
        raise HTTPException(
            status_code=503,
            detail="Geometry cache manifest publish could not be verified. Retry the request.",
        )


def load_or_build_geometry(profile: RevolvedProfile, owner: str) -> tuple[dict[str, bytes], bool]:
    """Return geometry files and whether this call was a cache hit.

    Cache hits never charge preview quota and never call Modal. Misses charge once,
    build (local CadQuery or Modal), then store under the versioned content digest.
    Per-digest locks reduce duplicate Modal work across concurrent callers when possible.
    """

    digest = profile_digest(profile)
    hit = _try_read(digest)
    if hit is not None:
        return hit, True

    with _digest_lock(digest):
        hit = _try_read(digest)
        if hit is not None:
            return hit, True

        claimed_remote = _claim_remote_lock(digest, owner)
        if claimed_remote is False:
            waited = _wait_for_cache(digest, attempts=24, delay_s=0.25)
            if waited is not None:
                return waited, True

        try:
            hit = _try_read(digest)
            if hit is not None:
                return hit, True

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
        finally:
            if claimed_remote is True:
                _release_remote_lock(digest, owner)


def _try_read(digest: str) -> dict[str, bytes] | None:
    local = read_local_cache(digest)
    if local is not None:
        return local
    if settings.production and settings.supabase_configured:
        remote = read_remote_cache(digest)
        if remote is not None:
            write_local_cache(digest, remote)
            return remote
    return None


def _wait_for_cache(digest: str, attempts: int, delay_s: float) -> dict[str, bytes] | None:
    for _ in range(attempts):
        time.sleep(delay_s)
        hit = _try_read(digest)
        if hit is not None:
            return hit
    return None


def _claim_remote_lock(digest: str, owner: str) -> bool | None:
    if not (settings.production and settings.supabase_configured):
        return True
    from drafty_api.storage import claim_geometry_build_lock_remote

    return claim_geometry_build_lock_remote(digest, owner)


def _release_remote_lock(digest: str, owner: str) -> None:
    if not (settings.production and settings.supabase_configured):
        return
    from drafty_api.storage import release_geometry_build_lock_remote

    release_geometry_build_lock_remote(digest, owner)


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
