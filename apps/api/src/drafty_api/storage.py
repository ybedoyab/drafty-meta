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
    key = settings.supabase_secret
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
                "scenario_id": job.get("scenario_id"),
                "optimization": job.get("optimization"),
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


def signed_artifact_url(job_id: str, name: str, expires: int = 3600) -> str | None:
    return signed_object_url(f"{job_id}/{name}", expires)


def signed_object_url(object_path: str, expires: int = 3600) -> str | None:
    if not settings.supabase_configured:
        return None
    base = settings.supabase_url.rstrip("/")
    key = settings.supabase_secret
    response = httpx.post(
        f"{base}/storage/v1/object/sign/artifacts/{object_path}",
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json={"expiresIn": expires},
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


def mirror_scenario(session: dict, access_token: str | None, snapshot: bool = False) -> str | None:
    """Save a scenario with the caller's Supabase token so RLS applies.

    A missing token or publishable key leaves the local file as the only copy.
    The service-role key is not sent on this request.
    """

    if not access_token or not settings.supabase_auth_configured:
        return None
    base = settings.supabase_url.rstrip("/")
    headers = {
        "apikey": settings.supabase_publishable_key,
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
    }
    state = {key: value for key, value in session.items() if key != "owner_id"}
    row = {
        "id": session["id"],
        "owner_id": session["owner_id"],
        "name": str(session.get("name") or "Untitled")[:120],
        "version": int(session.get("version") or 1),
        "state": state,
        "updated_at": session.get("updated_at"),
    }
    with httpx.Client(timeout=30) as client:
        response = client.post(f"{base}/rest/v1/scenarios?on_conflict=id", headers=headers, json=row)
        response.raise_for_status()
        if snapshot:
            version = client.post(
                f"{base}/rest/v1/scenario_versions",
                headers=headers,
                json={
                    "scenario_id": session["id"],
                    "owner_id": session["owner_id"],
                    "version": row["version"],
                    "inputs": session.get("inputs") or {},
                    "studio_spec": session.get("studio_spec"),
                    "studio_approval": session.get("studio_approval"),
                },
            )
            version.raise_for_status()
    return "mirrored"


def fetch_scenario(scenario_id: str, access_token: str | None) -> dict | None:
    if not access_token or not settings.supabase_auth_configured:
        return None
    base = settings.supabase_url.rstrip("/")
    response = httpx.get(
        f"{base}/rest/v1/scenarios",
        headers={
            "apikey": settings.supabase_publishable_key,
            "Authorization": f"Bearer {access_token}",
        },
        params={"id": f"eq.{scenario_id}", "select": "id,owner_id,state,version"},
        timeout=30,
    )
    response.raise_for_status()
    rows = response.json()
    if not rows:
        return None
    row = rows[0]
    state = dict(row.get("state") or {})
    state["id"] = row["id"]
    state["owner_id"] = row["owner_id"]
    state["version"] = row.get("version") or state.get("version") or 1
    return state


def list_remote_scenarios(access_token: str | None) -> list[dict]:
    if not access_token or not settings.supabase_auth_configured:
        return []
    base = settings.supabase_url.rstrip("/")
    response = httpx.get(
        f"{base}/rest/v1/scenarios",
        headers={
            "apikey": settings.supabase_publishable_key,
            "Authorization": f"Bearer {access_token}",
        },
        params={"select": "id,name,version,updated_at,state", "order": "updated_at.desc"},
        timeout=30,
    )
    response.raise_for_status()
    return list(response.json())


def upload_private_object(object_path: str, data: bytes, content_type: str) -> bool:
    if not settings.supabase_configured:
        return False
    base = settings.supabase_url.rstrip("/")
    key = settings.supabase_secret
    response = httpx.post(
        f"{base}/storage/v1/object/artifacts/{object_path}",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": content_type,
            "x-upsert": "true",
        },
        content=data,
        timeout=60,
    )
    return response.status_code < 400


def download_private_object(object_path: str) -> bytes | None:
    if not settings.supabase_configured:
        return None
    base = settings.supabase_url.rstrip("/")
    key = settings.supabase_secret
    response = httpx.get(
        f"{base}/storage/v1/object/artifacts/{object_path}",
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
        timeout=60,
    )
    if response.status_code == 404:
        return None
    if response.status_code >= 400:
        return None
    return response.content


def _upload(client: httpx.Client, base: str, key: str, job_id: str, name: str, path: Path) -> None:
    content_type = CONTENT_TYPES.get(path.suffix.lower(), "application/octet-stream")
    with path.open("rb") as handle:
        response = client.post(
            f"{base}/storage/v1/object/artifacts/{job_id}/{name}",
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Content-Type": content_type,
                "x-upsert": "true",
            },
            content=handle,
        )
    response.raise_for_status()
