"""Durable local job records. The API returns a job id before CalculiX starts."""

import json
import os
import subprocess
import sys
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import HTTPException

from drafty_api.settings import ROOT, settings

ACTIVE = {"queued", "geometry", "meshing", "solving", "postprocessing"}
TERMINAL = {"completed", "failed", "cancelled"}


@contextmanager
def _job_lock():
    path = settings.data_dir / ".jobs.lock"
    path.parent.mkdir(parents=True, exist_ok=True)
    deadline = time.monotonic() + 5
    while True:
        try:
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            break
        except FileExistsError:
            try:
                if time.time() - path.stat().st_mtime > 30:
                    path.unlink()
                    continue
            except OSError:
                pass
            if time.monotonic() > deadline:
                raise HTTPException(status_code=429, detail="The local worker is busy. Retry shortly.")
            time.sleep(0.05)
    try:
        os.write(fd, str(os.getpid()).encode())
        yield
    finally:
        os.close(fd)
        path.unlink(missing_ok=True)


def create_job(owner_id: str, kind: str, spec: dict, options: dict | None = None) -> dict:
    with _job_lock():
        _enforce_quota(owner_id)
        job_id = str(uuid.uuid4())
        now = _now()
        job = {
            "id": job_id,
            "owner_id": owner_id,
            "kind": kind,
            "status": "queued",
            "message": "Queued",
            "spec": spec,
            "options": options or {},
            "error": None,
            "summary": None,
            "created_at": now,
            "updated_at": now,
        }
        directory = job_dir(job_id)
        directory.mkdir(parents=True, exist_ok=False)
        _write(directory / "job.json", job)
    _spawn(directory)
    return job


def job_dir(job_id: str) -> Path:
    try:
        if str(uuid.UUID(job_id)) != job_id:
            raise ValueError
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Job not found.") from exc
    return settings.data_dir / "jobs" / job_id


def read_job(job_id: str, owner_id: str) -> dict:
    path = job_dir(job_id) / "job.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Job not found.")
    job = json.loads(path.read_text(encoding="utf-8"))
    if job["owner_id"] != owner_id:
        raise HTTPException(status_code=404, detail="Job not found.")
    return job


def list_jobs(owner_id: str) -> list[dict]:
    root = settings.data_dir / "jobs"
    if not root.exists():
        return []
    jobs = []
    for directory in root.iterdir():
        path = directory / "job.json"
        if not path.exists():
            continue
        try:
            job = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        if job.get("owner_id") == owner_id:
            jobs.append(job)
    jobs.sort(key=lambda item: item.get("created_at", ""), reverse=True)
    return jobs


def request_cancel(job_id: str, owner_id: str) -> dict:
    job = read_job(job_id, owner_id)
    if job["status"] in TERMINAL:
        return job
    (job_dir(job_id) / "cancel").write_text("cancel", encoding="utf-8")
    return job


def recover_interrupted_jobs() -> None:
    root = settings.data_dir / "jobs"
    if not root.exists():
        return
    for directory in root.iterdir():
        path = directory / "job.json"
        if not path.exists():
            continue
        try:
            job = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        status = job.get("status")
        if status == "queued":
            if claim_is_fresh(directory):
                continue
            _release_claim(directory)
            if spawn_enabled():
                _spawn(directory)
        elif status in ACTIVE and not _heartbeat_fresh(job, directory):
            _release_claim(directory)
            job["status"] = "failed"
            job["error"] = "The worker stopped before this job finished. Submit it again."
            job["updated_at"] = _now()
            _write(path, job)


def spawn_enabled() -> bool:
    mode = settings.drafty_spawn_local
    if mode == "never":
        return False
    if mode == "always":
        return True
    return os.environ.get("DRAFTY_IN_WORKER") != "1"


def claim_is_fresh(directory: Path) -> bool:
    path = directory / "claim"
    if not path.exists():
        return False
    return time.time() - path.stat().st_mtime <= settings.drafty_heartbeat_stale_s


def acquire_claim(directory: Path) -> bool:
    path = directory / "claim"
    if path.exists() and claim_is_fresh(directory):
        return False
    _release_claim(directory)
    try:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        return False
    try:
        os.write(fd, str(os.getpid()).encode())
    finally:
        os.close(fd)
    return True


def touch_claim(directory: Path) -> None:
    path = directory / "claim"
    if path.exists():
        os.utime(path, None)


def _release_claim(directory: Path) -> None:
    path = directory / "claim"
    try:
        path.unlink(missing_ok=True)
    except OSError:
        return


def _heartbeat_fresh(job: dict, directory: Path) -> bool:
    parsed = _parse_time(str(job.get("heartbeat_at") or ""))
    if parsed is not None:
        age = (datetime.now(timezone.utc) - parsed).total_seconds()
        if age <= settings.drafty_heartbeat_stale_s:
            return True
    return claim_is_fresh(directory)


def update_job(directory: Path, **fields: object) -> dict:
    path = directory / "job.json"
    job = json.loads(path.read_text(encoding="utf-8"))
    job.update(fields)
    job["updated_at"] = _now()
    _write(path, job)
    return job


def _enforce_quota(owner_id: str) -> None:
    owned = list_jobs(owner_id)
    active = [job for job in owned if job.get("status") in ACTIVE]
    if len(active) >= settings.drafty_max_concurrent_jobs:
        raise HTTPException(
            status_code=429,
            detail=f"Concurrent job limit is {settings.drafty_max_concurrent_jobs}.",
        )
    global_active = 0
    root = settings.data_dir / "jobs"
    if root.exists():
        for directory in root.iterdir():
            path = directory / "job.json"
            if not path.exists():
                continue
            try:
                job = json.loads(path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                continue
            if job.get("status") in ACTIVE:
                global_active += 1
    if global_active >= settings.drafty_max_global_jobs:
        raise HTTPException(status_code=429, detail="The local worker is already at capacity.")
    cutoff = datetime.now(timezone.utc) - timedelta(hours=1)
    recent = 0
    for job in owned:
        created = _parse_time(job.get("created_at", ""))
        if created is not None and created >= cutoff:
            recent += 1
    if recent >= settings.drafty_max_jobs_per_hour:
        raise HTTPException(status_code=429, detail="Hourly job limit reached.")


def _spawn(directory: Path) -> subprocess.Popen | None:
    if not spawn_enabled() or claim_is_fresh(directory):
        return None
    log_handle = (directory / "worker.log").open("a", encoding="utf-8")
    kwargs: dict = {"stdout": log_handle, "stderr": subprocess.STDOUT, "cwd": str(ROOT)}
    if os.name == "nt":
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        kwargs["start_new_session"] = True
    process = subprocess.Popen(
        [sys.executable, "-m", "drafty_api.executor", "--job-dir", str(directory)],
        **kwargs,
    )
    log_handle.close()
    return process


def charge_preview(owner_id: str) -> None:
    path = settings.data_dir / "preview-quota.json"
    with _job_lock():
        payload = {"owners": {}}
        if path.exists():
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                payload = {"owners": {}}
        owners = payload.setdefault("owners", {})
        cutoff = datetime.now(timezone.utc) - timedelta(hours=1)
        recent = []
        for stamp in owners.get(owner_id, []):
            parsed = _parse_time(stamp)
            if parsed is not None and parsed >= cutoff:
                recent.append(stamp)
        if len(recent) >= settings.drafty_max_previews_per_hour:
            raise HTTPException(status_code=429, detail="Hourly preview limit reached.")
        recent.append(_now())
        owners[owner_id] = recent
        _write(path, payload)


def _write(path: Path, payload: dict) -> None:
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    temporary.replace(path)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_time(value: str) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed
