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


def delete_remote_scenario(scenario_id: str, access_token: str | None) -> bool | None:
    """Delete a mirrored scenario row with the caller's token so RLS applies. None when unconfigured."""

    if not access_token or not settings.supabase_auth_configured:
        return None
    base = settings.supabase_url.rstrip("/")
    response = httpx.delete(
        f"{base}/rest/v1/scenarios",
        headers={
            "apikey": settings.supabase_publishable_key,
            "Authorization": f"Bearer {access_token}",
        },
        params={"id": f"eq.{scenario_id}"},
        timeout=30,
    )
    return response.status_code < 400


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


def upload_private_object_if_absent(object_path: str, data: bytes, content_type: str) -> bool:
    """Store once. Existing objects stay immutable (no upsert)."""

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
            "x-upsert": "false",
        },
        content=data,
        timeout=60,
    )
    # 409 = already present; treat as success for content-addressed digests.
    return response.status_code < 400 or response.status_code == 409


def delete_private_object(object_path: str) -> bool:
    """Best-effort delete of one private storage object. Missing objects are success."""

    if not settings.supabase_configured:
        return True
    base = settings.supabase_url.rstrip("/")
    key = settings.supabase_secret
    response = httpx.delete(
        f"{base}/storage/v1/object/artifacts/{object_path}",
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
        timeout=30,
    )
    return response.status_code < 400 or response.status_code == 404


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


def private_object_exists(object_path: str) -> bool | None:
    """True/False when storage answers; None when Supabase is not configured."""

    if not settings.supabase_configured:
        return None
    base = settings.supabase_url.rstrip("/")
    key = settings.supabase_secret
    response = httpx.head(
        f"{base}/storage/v1/object/artifacts/{object_path}",
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
        timeout=30,
    )
    if response.status_code == 404:
        return False
    if response.status_code >= 400:
        # Some Storage deployments reject HEAD; fall back to a ranged GET.
        probe = httpx.get(
            f"{base}/storage/v1/object/artifacts/{object_path}",
            headers={"apikey": key, "Authorization": f"Bearer {key}", "Range": "bytes=0-0"},
            timeout=30,
        )
        if probe.status_code == 404:
            return False
        if probe.status_code >= 400:
            return False
        return True
    return True


def delete_private_objects(object_paths: list[str]) -> tuple[int, list[str]]:
    """Idempotent multi-delete. Missing objects count as success. Returns (removed, errors)."""

    removed = 0
    errors: list[str] = []
    for path in object_paths:
        if not path or path.startswith("geometry/"):
            # Shared content-addressed geometry must never be deleted from this helper.
            if path.startswith("geometry/"):
                errors.append(f"refused:{path}")
            continue
        if delete_private_object(path):
            removed += 1
        else:
            errors.append(path)
    return removed, errors


def call_service_rpc(function_name: str, payload: dict) -> object | None:
    """Invoke a Postgres RPC with the service role. None means the backend did not answer."""

    if not settings.supabase_configured:
        return None
    try:
        response = httpx.post(
            f"{settings.supabase_url.rstrip('/')}/rest/v1/rpc/{function_name}",
            headers={
                "apikey": settings.supabase_secret,
                "Authorization": f"Bearer {settings.supabase_secret}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=30,
        )
    except httpx.HTTPError:
        return None
    if response.status_code >= 400:
        return None
    if response.content in (b"", b"null"):
        return None
    try:
        return response.json()
    except json.JSONDecodeError:
        return None


def charge_preview_quota_remote(owner_id: str, limit: int) -> bool | None:
    """Atomic hourly preview charge. True/False from RPC; None when unavailable."""

    result = call_service_rpc(
        "charge_preview_quota",
        {"p_owner_id": owner_id, "p_limit": int(limit)},
    )
    if result is None:
        return None
    return bool(result)


def claim_geometry_build_lock_remote(digest: str, owner_id: str, ttl_seconds: int = 120) -> bool | None:
    """Try to claim a short-lived per-digest build lock. None when the backend is unavailable."""

    result = call_service_rpc(
        "claim_geometry_build_lock",
        {"p_digest": digest, "p_owner_id": owner_id, "p_ttl_seconds": int(ttl_seconds)},
    )
    if result is None:
        return None
    return bool(result)


def release_geometry_build_lock_remote(digest: str, owner_id: str) -> None:
    call_service_rpc(
        "release_geometry_build_lock",
        {"p_digest": digest, "p_owner_id": owner_id},
    )


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
