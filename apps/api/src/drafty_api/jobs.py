"""Durable local job records. The API returns a job id before CalculiX starts."""

import json
import os
import subprocess
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import HTTPException

from drafty_api.settings import ROOT, settings

ACTIVE = {"queued", "geometry", "meshing", "solving", "postprocessing"}
TERMINAL = {"completed", "failed", "cancelled"}


def create_job(owner_id: str, kind: str, spec: dict, options: dict | None = None) -> dict:
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
    if "/" in job_id or "\\" in job_id or job_id in {"", ".", ".."}:
        raise HTTPException(status_code=404, detail="Job not found.")
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
            _spawn(directory)
        elif status in ACTIVE:
            job["status"] = "failed"
            job["error"] = "The API restarted while this job was running. Submit it again."
            job["updated_at"] = _now()
            _write(path, job)


def update_job(directory: Path, **fields: object) -> dict:
    path = directory / "job.json"
    job = json.loads(path.read_text(encoding="utf-8"))
    job.update(fields)
    job["updated_at"] = _now()
    _write(path, job)
    return job


def _enforce_quota(owner_id: str) -> None:
    jobs = list_jobs(owner_id)
    active = [job for job in jobs if job.get("status") in ACTIVE]
    if len(active) >= settings.drafty_max_concurrent_jobs:
        raise HTTPException(
            status_code=429,
            detail=f"Concurrent job limit is {settings.drafty_max_concurrent_jobs}.",
        )
    cutoff = datetime.now(timezone.utc) - timedelta(hours=1)
    recent = 0
    for job in jobs:
        created = _parse_time(job.get("created_at", ""))
        if created is not None and created >= cutoff:
            recent += 1
    if recent >= settings.drafty_max_jobs_per_hour:
        raise HTTPException(status_code=429, detail="Hourly job limit reached.")


def _spawn(directory: Path) -> None:
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
