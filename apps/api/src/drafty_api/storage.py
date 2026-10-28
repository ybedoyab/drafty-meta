"""Optional Supabase persistence. Local files remain the source of the running job."""

import json
from pathlib import Path

import httpx

from drafty_api.settings import settings

CONTENT_TYPES = {
    ".glb": "model/gltf-binary",
    ".step": "application/step",
    ".inp": "text/plain",
    ".dat": "text/plain",
    ".frd": "application/octet-stream",
    ".vtu": "application/octet-stream",
    ".scad": "text/plain",
    ".json": "application/json",
    ".log": "text/plain",
    ".sta": "text/plain",
}


def sync_job(job_dir: Path) -> str | None:
    if not settings.supabase_configured:
        return None
    job = json.loads((job_dir / "job.json").read_text(encoding="utf-8"))
    base = settings.supabase_url.rstrip("/")
    key = settings.supabase_service_role_key
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
    }
    with httpx.Client(timeout=60) as client:
        response = client.post(
            f"{base}/rest/v1/jobs?on_conflict=id",
            headers=headers,
            json={
                "id": job["id"],
                "owner_id": job["owner_id"],
                "kind": job["kind"],
                "status": job["status"],
                "spec": job["spec"],
                "error": job.get("error"),
                "summary": job.get("summary"),
            },
        )
        response.raise_for_status()
        for path in job_dir.iterdir():
            if not path.is_file() or path.stat().st_size > 40_000_000:
                continue
            _upload(client, base, key, job["id"], path.name, path)
        results = job_dir / "results.json"
        if results.exists():
            client.post(
                f"{base}/rest/v1/results?on_conflict=job_id",
                headers=headers,
                json={"job_id": job["id"], "summary": job.get("summary") or {}},
            )
    return "uploaded"


def signed_artifact_url(job_id: str, name: str) -> str | None:
    if not settings.supabase_configured:
        return None
    base = settings.supabase_url.rstrip("/")
    key = settings.supabase_service_role_key
    response = httpx.post(
        f"{base}/storage/v1/object/sign/artifacts/{job_id}/{name}",
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json={"expiresIn": 3600},
        timeout=30,
    )
    if response.status_code >= 400:
        return None
    signed = response.json().get("signedURL") or response.json().get("signedUrl")
    if not signed:
        return None
    if signed.startswith("http"):
        return signed
    return f"{base}/storage/v1{signed}"


def _upload(client: httpx.Client, base: str, key: str, job_id: str, name: str, path: Path) -> None:
    content_type = CONTENT_TYPES.get(path.suffix.lower(), "application/octet-stream")
    response = client.post(
        f"{base}/storage/v1/object/artifacts/{job_id}/{name}",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": content_type,
            "x-upsert": "true",
        },
        content=path.read_bytes(),
    )
    response.raise_for_status()
