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
import logging
import re
import shutil
import threading
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path

from fastapi import HTTPException

from drafty_api.settings import settings
from drafty_engineering.artifacts import MAX_ARTIFACT_BYTES
from drafty_engineering.spec import RevolvedProfile

_LOG = logging.getLogger("drafty_api.geometry")
_SECRET_RE = re.compile(
    r"(?i)(bearer\s+[a-z0-9._\-]+|api[_-]?key\s*[:=]\s*\S+|token\s*[:=]\s*\S+|eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+)"
)

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


# Stale queued/running builds are marked failed without spawning another Modal job.
GEOMETRY_BUILD_STALE_AFTER_S = 600
# After charge/mark, wait this long before another worker may resume spawn (crash window).
GEOMETRY_BUILD_RESUME_AFTER_S = 45


class GeometryPending(Exception):
    """Durable Modal geometry build has started or is still running."""

    def __init__(self, digest: str, status: str) -> None:
        self.digest = digest
        self.status = status
        super().__init__(f"Geometry build {status} for {digest}")


def load_or_build_geometry(profile: RevolvedProfile, owner: str) -> tuple[dict[str, bytes], bool]:
    """Return geometry files and whether this call was a cache hit.

    Cache hits never charge preview quota and never call Modal. Misses charge once,
    build (local CadQuery or Modal), then store under the versioned content digest.

    In production, Modal generation is durable and asynchronous: claim → charge →
    spawn → attach call id, then poll. Partial failures use conditional transitions so
    quota is not double-charged and concurrent pollers cannot overwrite terminal states.
    """

    digest = profile_digest(profile)
    hit = _try_read(digest)
    if hit is not None:
        return hit, True

    if settings.production:
        return _load_or_progress_remote(profile, owner, digest)

    with _digest_lock(digest):
        hit = _try_read(digest)
        if hit is not None:
            return hit, True

        from drafty_api.jobs import charge_preview

        charge_preview(owner)
        files = _export_local(profile)
        verify_files(files, build_manifest(files, digest), digest)
        cached = write_local_cache(digest, files)
        return cached, False


def _load_or_progress_remote(
    profile: RevolvedProfile, owner: str, digest: str
) -> tuple[dict[str, bytes], bool]:
    """Production path: digest cache, durable Modal job, no sync wait on the request."""

    progressed = _progress_existing_build(digest)
    if progressed is not None:
        return progressed, False

    with _digest_lock(digest):
        hit = _try_read(digest)
        if hit is not None:
            return hit, True

        progressed = _progress_existing_build(digest)
        if progressed is not None:
            return progressed, False

        claim = _claim_build_start(digest, owner, profile.model_dump())
        if claim is None:
            raise HTTPException(
                status_code=503,
                detail="Geometry build status backend is unavailable. Retry shortly.",
            )

        if not claim.get("claimed"):
            status = str(claim.get("status") or "")
            if status == "completed":
                hit = _try_read(digest)
                if hit is not None:
                    return hit, True
                raise HTTPException(
                    status_code=503,
                    detail={
                        "message": "Geometry is marked complete but the cache is not ready. Retry shortly.",
                        "digest": digest,
                        "retryable": True,
                    },
                )
            if status in {"queued", "running"}:
                raise GeometryPending(digest, status or "running")
            raise HTTPException(
                status_code=503,
                detail={
                    "message": "Geometry build is in progress on another instance. Retry shortly.",
                    "digest": digest,
                    "retryable": True,
                },
            )

        # Winner: durable charge before spawn, then attach call id (cancel spawn if attach fails).
        stage_started = time.perf_counter()
        if not bool(claim.get("charged")):
            from drafty_api.jobs import charge_preview

            charge_preview(owner)
            marked = _mark_build_charged(digest)
            if marked is not True:
                _log_geometry_stage(
                    digest,
                    "mark_charged",
                    ok=False,
                    http_status=503,
                    elapsed_ms=_elapsed_ms(stage_started),
                    error="charge_not_persisted",
                )
                raise HTTPException(
                    status_code=503,
                    detail="Geometry build charge could not be persisted. Retry shortly.",
                )
            _log_geometry_stage(
                digest,
                "mark_charged",
                ok=True,
                http_status=200,
                elapsed_ms=_elapsed_ms(stage_started),
            )

        from drafty_api.remote import cancel_remote_geometry_call, spawn_remote_geometry

        spawn_started = time.perf_counter()
        try:
            call_id = spawn_remote_geometry(profile.model_dump())
        except HTTPException as exc:
            _fail_build_after_spawn_error(digest, exc)
            _log_geometry_stage(
                digest,
                "spawn",
                ok=False,
                http_status=exc.status_code,
                elapsed_ms=_elapsed_ms(spawn_started),
                error_class=type(exc).__name__,
                error=_sanitize_error(exc.detail),
                modal_call_id_present=False,
            )
            raise
        except Exception as exc:
            message = _sanitize_error(exc) or "Modal geometry spawn failed."
            _fail_build_after_spawn_error(digest, message)
            _log_geometry_stage(
                digest,
                "spawn",
                ok=False,
                http_status=502,
                elapsed_ms=_elapsed_ms(spawn_started),
                error_class=type(exc).__name__,
                error=message,
                modal_call_id_present=False,
            )
            raise HTTPException(
                status_code=502,
                detail={
                    "message": message,
                    "digest": digest[:12],
                    "retryable": True,
                },
            ) from exc

        _log_geometry_stage(
            digest,
            "spawn",
            ok=True,
            http_status=200,
            elapsed_ms=_elapsed_ms(spawn_started),
            modal_call_id_present=True,
        )
        attached = _attach_build_call(digest, call_id)
        if attached is not True:
            cancel_remote_geometry_call(call_id)
            _log_geometry_stage(
                digest,
                "attach",
                ok=False,
                http_status=503,
                elapsed_ms=_elapsed_ms(spawn_started),
                modal_call_id_present=True,
                error="attach_failed",
            )
            raise HTTPException(
                status_code=503,
                detail={
                    "message": "Geometry build call could not be recorded. Retry shortly.",
                    "digest": digest,
                    "retryable": True,
                },
            )

        _log_geometry_stage(
            digest,
            "attach",
            ok=True,
            http_status=202,
            elapsed_ms=_elapsed_ms(spawn_started),
            modal_call_id_present=True,
        )
        raise GeometryPending(digest, "running")


def _progress_existing_build(digest: str) -> dict[str, bytes] | None:
    build = _remote_build_row(digest)
    if not build:
        return None
    status = str(build.get("status") or "")
    call_id = build.get("modal_call_id")

    if status == "failed":
        return None
    if status == "completed":
        return _try_read(digest)

    if status not in {"queued", "running"}:
        return None

    if _build_is_stale(build):
        # Bounded recovery: fail the attempt. Do not spawn another paid Modal call here.
        _transition_build(digest, ["queued", "running"], "failed", error="Geometry build timed out.")
        raise HTTPException(
            status_code=503,
            detail={
                "message": "Geometry build timed out. Retry to start a new attempt.",
                "digest": digest,
                "retryable": True,
            },
        )

    if not call_id:
        # Let claim_start decide wait-vs-resume for the charge→spawn crash window.
        return None

    from drafty_api.remote import poll_remote_geometry

    try:
        files = poll_remote_geometry(str(call_id), timeout=0)
    except HTTPException as exc:
        _transition_build(digest, ["queued", "running"], "failed", error=str(exc.detail)[:500])
        raise
    except Exception as exc:
        _transition_build(digest, ["queued", "running"], "failed", error=str(exc)[:500])
        raise HTTPException(status_code=502, detail="Modal geometry build failed.") from exc

    if files is None:
        raise GeometryPending(digest, status or "running")

    verify_files(files, build_manifest(files, digest), digest)
    cached = write_local_cache(digest, files)
    if settings.supabase_configured:
        write_remote_cache(digest, cached)
    # Conditional complete: concurrent pollers cannot overwrite a peer's completed/failed.
    completed = _transition_build(digest, ["queued", "running"], "completed")
    if completed is False:
        latest = _remote_build_row(digest) or {}
        latest_status = str(latest.get("status") or "")
        if latest_status == "completed":
            return _try_read(digest) or cached
        if latest_status == "failed":
            raise HTTPException(
                status_code=502,
                detail=str(latest.get("error") or "Geometry build failed."),
            )
        raise GeometryPending(digest, latest_status or "running")
    if completed is None:
        # Transition backend unavailable after cache publish — bytes are safe to serve.
        return cached
    return cached


def _build_is_stale(build: dict) -> bool:
    raw = build.get("updated_at")
    if not raw:
        return False
    try:
        text = str(raw).replace("Z", "+00:00")
        updated = datetime.fromisoformat(text)
        if updated.tzinfo is None:
            updated = updated.replace(tzinfo=UTC)
    except ValueError:
        return False
    age = datetime.now(UTC) - updated.astimezone(UTC)
    return age.total_seconds() > GEOMETRY_BUILD_STALE_AFTER_S


def _remote_build_row(digest: str) -> dict | None:
    if not settings.supabase_configured:
        return None
    from drafty_api.storage import get_geometry_build_remote

    return get_geometry_build_remote(digest)


def _claim_build_start(digest: str, owner: str, profile: dict) -> dict | None:
    if not settings.supabase_configured:
        return None
    from drafty_api.storage import claim_geometry_build_start_remote

    return claim_geometry_build_start_remote(
        digest,
        owner,
        profile=profile,
        stale_after_seconds=GEOMETRY_BUILD_STALE_AFTER_S,
        resume_after_seconds=GEOMETRY_BUILD_RESUME_AFTER_S,
    )


def _mark_build_charged(digest: str) -> bool | None:
    if not settings.supabase_configured:
        return None
    from drafty_api.storage import mark_geometry_build_charged_remote

    return mark_geometry_build_charged_remote(digest)


def _attach_build_call(digest: str, call_id: str) -> bool | None:
    if not settings.supabase_configured:
        return None
    from drafty_api.storage import attach_geometry_build_call_remote

    return attach_geometry_build_call_remote(digest, call_id)


def _transition_build(
    digest: str,
    from_statuses: list[str],
    to_status: str,
    *,
    error: str | None = None,
) -> bool | None:
    if not settings.supabase_configured:
        return None
    from drafty_api.storage import transition_geometry_build_remote

    return transition_geometry_build_remote(digest, from_statuses, to_status, error=error)


def _elapsed_ms(started: float) -> int:
    return max(0, int((time.perf_counter() - started) * 1000))


def _sanitize_error(detail: object) -> str:
    if isinstance(detail, dict):
        detail = detail.get("message") or detail.get("detail") or detail
    text = str(detail or "").replace("\n", " ").strip()
    text = _SECRET_RE.sub("[REDACTED]", text)
    return text[:240]


def _log_geometry_stage(
    digest: str,
    stage: str,
    *,
    ok: bool,
    http_status: int | None = None,
    elapsed_ms: int | None = None,
    modal_call_id_present: bool | None = None,
    error_class: str | None = None,
    error: object | None = None,
) -> None:
    payload = {
        "event": "geometry_lifecycle",
        "digest_prefix": (digest or "")[:12],
        "stage": stage,
        "ok": bool(ok),
        "http_status": http_status,
        "elapsed_ms": elapsed_ms,
        "modal_call_id_present": modal_call_id_present,
        "error_class": error_class,
        "error": _sanitize_error(error) if error is not None else None,
    }
    _LOG.info("%s", json.dumps(payload, separators=(",", ":"), default=str))


def _fail_build_after_spawn_error(digest: str, detail: object) -> None:
    """Mark charged/queued builds failed when Modal never returned a call id.

    Prevents indefinite CAD-pending polls that never attach a FunctionCall id and
    never surface a terminal error to the client.
    """

    message = _sanitize_error(detail) or "Modal geometry spawn failed."
    _transition_build(digest, ["queued", "running"], "failed", error=message)


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


def _claim_remote_lock(digest: str, owner: str, ttl_seconds: int = 120) -> bool | None:
    """True when claimed, False when held elsewhere, None when the backend is unavailable."""

    if not (settings.production and settings.supabase_configured):
        return True
    from drafty_api.storage import claim_geometry_build_lock_remote

    return claim_geometry_build_lock_remote(digest, owner, ttl_seconds=ttl_seconds)


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
