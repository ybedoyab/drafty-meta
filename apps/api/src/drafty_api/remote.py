"""Durable Modal jobs. The request that creates a job does not wait for CalculiX."""

import hashlib
import json
import os
import secrets
import uuid
from datetime import datetime, timezone

import httpx
from fastapi import HTTPException

from drafty_api.settings import settings
from drafty_engineering.artifacts import ARTIFACT_NAMES, MAX_ARTIFACT_BYTES

ACTIVE_REMOTE = {
    "queued",
    "submitted",
    "running",
    "geometry",
    "meshing",
    "solving",
    "postprocessing",
    "transferring",
    "cancel_requested",
}
TERMINAL_REMOTE = {"completed", "failed", "cancelled", "timed_out"}


def create_remote_job(
    owner_id: str,
    kind: str,
    spec: dict,
    options: dict | None,
    scenario_id: str | None,
    compute: str,
) -> dict:
    if compute != "modal":
        raise HTTPException(
            status_code=409,
            detail="This deployment runs CalculiX on Modal. Local CalculiX was not started.",
        )
    if not settings.modal_available:
        raise HTTPException(
            status_code=409,
            detail="Modal Cloud CalculiX is not configured. Local CalculiX was not started.",
        )
    request_hash = hashlib.sha256(
        json.dumps(
            {"kind": kind, "spec": spec, "scenario_id": scenario_id, "compute": compute, "options": options or {}},
            sort_keys=True,
        ).encode()
    ).hexdigest()
    _reject_duplicate(owner_id, request_hash)
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
        "error": None,
        "summary": None,
        "scenario_id": scenario_id,
        "optimization": options,
        "compute": "modal",
        "request_hash": request_hash,
        "artifact_storage": "supabase",
        "created_at": now,
        "updated_at": now,
    }
    _insert("jobs", job)
    token = secrets.token_urlsafe(32)
    _insert("job_dispatch", {"job_id": job_id, "callback_token": token})
    try:
        call_id = _spawn(kind, spec, job_id, options, token)
    except Exception as exc:
        _update_job(job_id, {"status": "failed", "message": "Failed", "error": exc.__class__.__name__})
        raise HTTPException(
            status_code=502,
            detail="Modal did not accept the job. Local CalculiX was not started.",
        ) from exc
    return _update_job(
        job_id,
        {"status": "submitted", "message": "Submitted to Modal", "modal_call_id": call_id},
        dispatch={"modal_call_id": call_id},
    )


def read_remote_job(job_id: str, owner_id: str) -> dict:
    _uuid(job_id)
    rows = _select("jobs", {"id": f"eq.{job_id}", "owner_id": f"eq.{owner_id}", "select": "*"})
    if not rows:
        raise HTTPException(status_code=404, detail="Job not found.")
    job = rows[0]
    if job.get("status") in ACTIVE_REMOTE:
        _reconcile(job)
        rows = _select("jobs", {"id": f"eq.{job_id}", "owner_id": f"eq.{owner_id}", "select": "*"})
        if rows:
            job = rows[0]
    return job


def list_remote_jobs(owner_id: str) -> list[dict]:
    return _select(
        "jobs",
        {"owner_id": f"eq.{owner_id}", "select": "*", "order": "created_at.desc", "limit": "50"},
    )


def cancel_remote_job(job_id: str, owner_id: str) -> dict:
    job = read_remote_job(job_id, owner_id)
    if job.get("status") in TERMINAL_REMOTE:
        return job
    dispatch = _dispatch(job_id)
    _update_job(job_id, {"status": "cancel_requested", "message": "Cancel requested"})
    call_id = (dispatch or {}).get("modal_call_id")
    if call_id:
        try:
            import modal

            modal.FunctionCall.from_id(str(call_id)).cancel()
        except Exception:
            pass
    return read_remote_job(job_id, owner_id)


def complete_remote_job(job_id: str, token: str, payload: dict) -> dict:
    _uuid(job_id)
    dispatch = _dispatch(job_id)
    expected = (dispatch or {}).get("callback_token") or ""
    if not expected or not secrets.compare_digest(expected, token):
        raise HTTPException(status_code=401, detail="The job callback was rejected.")
    rows = _select("jobs", {"id": f"eq.{job_id}", "select": "*"})
    if not rows:
        raise HTTPException(status_code=404, detail="Job not found.")
    job = rows[0]
    if job.get("status") == "completed":
        return job
    if job.get("status") in TERMINAL_REMOTE:
        raise HTTPException(status_code=409, detail="The job is already finished.")
    status = str(payload.get("status") or "")
    if status == "failed":
        return _update_job(
            job_id,
            {
                "status": "failed",
                "message": "Failed",
                "error": str(payload.get("error") or "Modal reported a failure.")[:500],
            },
        )
    if status != "completed":
        raise HTTPException(status_code=422, detail="The callback status is not recognized.")
    _update_job(job_id, {"status": "transferring", "message": "Checking artifacts"})
    manifest = payload.get("manifest") or []
    try:
        verified = _verify_manifest(job_id, manifest)
    except Exception as exc:
        _update_job(job_id, {"status": "failed", "message": "Failed", "error": str(exc)[:500]})
        raise HTTPException(status_code=409, detail="The artifact set was not accepted.") from exc
    if not any(item["name"] == "results.json" for item in verified):
        _update_job(job_id, {"status": "failed", "message": "Failed", "error": "results.json was not uploaded."})
        raise HTTPException(status_code=409, detail="The solve finished without results.json.")
    for item in verified:
        _insert(
            "artifacts",
            {
                "job_id": job_id,
                "name": item["name"],
                "storage_path": f"{job_id}/{item['name']}",
                "content_type": "application/octet-stream",
            },
            on_conflict="job_id,name",
        )
    summary = payload.get("summary") if isinstance(payload.get("summary"), dict) else {}
    finished = _update_job(
        job_id,
        {
            "status": "completed",
            "message": "Completed",
            "error": None,
            "summary": summary,
            "artifact_storage": "supabase",
        },
    )
    _insert("results", {"job_id": job_id, "summary": summary}, on_conflict="job_id")
    return finished


def remote_preview(spec: dict) -> bytes:
    import modal

    call = modal.Function.from_name("drafty-engineering", "generate_preview").spawn(spec)
    try:
        payload = call.get(timeout=50)
    except TimeoutError as exc:
        _cancel_call(call)
        raise HTTPException(
            status_code=504,
            detail="The solid is still building on Modal. Preview again in a moment.",
        ) from exc
    if not isinstance(payload, (bytes, bytearray)) or not payload:
        raise HTTPException(status_code=502, detail="Modal did not return a preview.")
    return bytes(payload)


_PROVIDER_CACHE: dict = {"at": 0.0, "value": None}


def provider_status() -> dict:
    import time

    now = time.time()
    cached = _PROVIDER_CACHE["value"]
    if cached is not None and now - float(_PROVIDER_CACHE["at"]) < 30:
        return cached
    modal_configured = settings.modal_available
    supabase_configured = settings.supabase_configured
    meta_configured = settings.meta_configured
    supabase_reachable = _supabase_reachable() if supabase_configured else False
    modal_reachable = _modal_reachable() if modal_configured else False
    modal_tested = _modal_tested() if supabase_reachable else False
    value = {
        "meta": {"configured": meta_configured, "reachable": False, "tested": False},
        "modal": {"configured": modal_configured, "reachable": modal_reachable, "tested": modal_tested},
        "supabase": {"configured": supabase_configured, "reachable": supabase_reachable, "tested": supabase_reachable},
    }
    _PROVIDER_CACHE["at"] = now
    _PROVIDER_CACHE["value"] = value
    return value


def _spawn(kind: str, spec: dict, job_id: str, options: dict | None, token: str) -> str:
    import modal

    delivery = {
        "uploads": _upload_targets(job_id),
        "callback_url": f"{_api_origin()}/api/v1/internal/jobs/{job_id}/complete",
        "callback_token": token,
    }
    if not delivery["callback_url"].startswith("https://"):
        raise RuntimeError("DRAFTY_API_ORIGIN is not set.")
    if kind == "optimization":
        function = modal.Function.from_name("drafty-engineering", "optimize_design")
        call = function.spawn(spec, job_id, options or {}, delivery)
    else:
        function = modal.Function.from_name("drafty-engineering", "run_simulation")
        call = function.spawn(spec, job_id, delivery)
    call_id = getattr(call, "object_id", None)
    if not call_id:
        raise RuntimeError("Modal did not return a FunctionCall id.")
    return str(call_id)


def _upload_targets(job_id: str) -> dict:
    targets = {}
    for name in ARTIFACT_NAMES:
        signed = _sign_upload(f"{job_id}/{name}")
        if signed:
            targets[name] = signed
    if "results.json" not in targets:
        raise RuntimeError("Supabase did not sign the results upload.")
    return targets


def _sign_upload(object_path: str) -> dict | None:
    if not settings.supabase_configured:
        return None
    base = settings.supabase_url.rstrip("/")
    response = httpx.post(
        f"{base}/storage/v1/object/upload/sign/artifacts/{object_path}",
        headers=_service_headers(),
        json={},
        timeout=30,
    )
    if response.status_code >= 400:
        return None
    body = response.json()
    url = str(body.get("url") or "")
    token = str(body.get("token") or "")
    if not url or not token:
        return None
    if not url.startswith("http"):
        url = f"{base}/storage/v1{url}"
    return {"url": url, "token": token}


def _verify_manifest(job_id: str, manifest: list) -> list[dict]:
    if not isinstance(manifest, list) or not manifest:
        raise RuntimeError("The callback did not include an artifact manifest.")
    verified = []
    for item in manifest:
        if not isinstance(item, dict):
            raise RuntimeError("The manifest is malformed.")
        name = str(item.get("name") or "")
        if name not in ARTIFACT_NAMES:
            raise RuntimeError("The manifest names an artifact that is not allowed.")
        expected = str(item.get("sha256") or "")
        hashed = _hash_object(f"{job_id}/{name}")
        if hashed is None:
            raise RuntimeError(f"{name} was not stored.")
        actual, size = hashed
        if size > MAX_ARTIFACT_BYTES:
            raise RuntimeError(f"{name} exceeds the artifact size limit.")
        if actual != expected:
            raise RuntimeError(f"{name} did not match its checksum.")
        verified.append({"name": name, "sha256": actual, "byte_length": size})
    return verified


def _download(object_path: str) -> bytes | None:
    base = settings.supabase_url.rstrip("/")
    response = httpx.get(
        f"{base}/storage/v1/object/artifacts/{object_path}",
        headers=_service_headers(),
        timeout=60,
    )
    if response.status_code == 404:
        return None
    response.raise_for_status()
    return response.content


def _hash_object(object_path: str) -> tuple[str, int] | None:
    base = settings.supabase_url.rstrip("/")
    hasher = hashlib.sha256()
    size = 0
    with httpx.stream(
        "GET",
        f"{base}/storage/v1/object/artifacts/{object_path}",
        headers=_service_headers(),
        timeout=120,
    ) as response:
        if response.status_code == 404:
            return None
        response.raise_for_status()
        for chunk in response.iter_bytes():
            size += len(chunk)
            if size > MAX_ARTIFACT_BYTES:
                raise RuntimeError(f"{object_path} exceeds the artifact size limit.")
            hasher.update(chunk)
    return hasher.hexdigest(), size


def _reconcile(job: dict) -> None:
    created = _parse_time(str(job.get("created_at") or ""))
    if created is not None:
        age = (datetime.now(timezone.utc) - created).total_seconds()
        if age > settings.drafty_solver_timeout_s and job.get("status") in {"queued", "submitted", "running"}:
            dispatch = _dispatch(str(job["id"]))
            call_id = (dispatch or {}).get("modal_call_id")
            if call_id:
                try:
                    import modal

                    modal.FunctionCall.from_id(str(call_id)).cancel()
                except Exception:
                    pass
            _update_job(
                str(job["id"]),
                {"status": "timed_out", "message": "Timed out", "error": "The solver timed out."},
            )
            return
    dispatch = _dispatch(str(job["id"]))
    call_id = (dispatch or {}).get("modal_call_id")
    if not call_id:
        return
    try:
        import modal

        modal.FunctionCall.from_id(str(call_id)).get(timeout=0)
    except TimeoutError:
        return
    except Exception:
        return
    stored = _download(f"{job['id']}/results.json")
    if stored:
        _update_job(
            str(job["id"]),
            {"status": "completed", "message": "Completed", "error": None, "artifact_storage": "supabase"},
        )


def _reject_duplicate(owner_id: str, request_hash: str) -> None:
    rows = _select(
        "jobs",
        {
            "owner_id": f"eq.{owner_id}",
            "request_hash": f"eq.{request_hash}",
            "status": f"in.({','.join(sorted(ACTIVE_REMOTE))})",
            "select": "id",
            "limit": "1",
        },
    )
    if rows:
        raise HTTPException(status_code=409, detail="A matching job is already running.")


def _enforce_quota(owner_id: str) -> None:
    rows = _select(
        "jobs",
        {
            "owner_id": f"eq.{owner_id}",
            "status": f"in.({','.join(sorted(ACTIVE_REMOTE))})",
            "select": "id",
        },
    )
    if len(rows) >= settings.drafty_max_concurrent_jobs:
        raise HTTPException(status_code=429, detail=f"Concurrent job limit is {settings.drafty_max_concurrent_jobs}.")


def _dispatch(job_id: str) -> dict | None:
    rows = _select("job_dispatch", {"job_id": f"eq.{job_id}", "select": "*"})
    return rows[0] if rows else None


def _insert(table: str, row: dict, on_conflict: str | None = None) -> None:
    params = {"on_conflict": on_conflict} if on_conflict else None
    prefer = "resolution=merge-duplicates,return=minimal" if on_conflict else "return=minimal"
    response = httpx.post(
        f"{settings.supabase_url.rstrip('/')}/rest/v1/{table}",
        headers={**_service_headers(), "Prefer": prefer},
        params=params,
        json=row,
        timeout=30,
    )
    response.raise_for_status()


def _update_job(job_id: str, fields: dict, dispatch: dict | None = None) -> dict:
    fields = {**fields, "updated_at": _now()}
    modal_call_id = fields.pop("modal_call_id", None)
    response = httpx.patch(
        f"{settings.supabase_url.rstrip('/')}/rest/v1/jobs",
        headers={**_service_headers(), "Prefer": "return=representation"},
        params={"id": f"eq.{job_id}"},
        json=fields,
        timeout=30,
    )
    response.raise_for_status()
    if dispatch or modal_call_id:
        patch = dict(dispatch or {})
        if modal_call_id:
            patch["modal_call_id"] = modal_call_id
        httpx.patch(
            f"{settings.supabase_url.rstrip('/')}/rest/v1/job_dispatch",
            headers={**_service_headers(), "Prefer": "return=minimal"},
            params={"job_id": f"eq.{job_id}"},
            json=patch,
            timeout=30,
        ).raise_for_status()
    rows = response.json()
    return rows[0] if isinstance(rows, list) and rows else fields


def _select(table: str, params: dict) -> list[dict]:
    if not settings.supabase_configured:
        return []
    response = httpx.get(
        f"{settings.supabase_url.rstrip('/')}/rest/v1/{table}",
        headers=_service_headers(),
        params=params,
        timeout=30,
    )
    response.raise_for_status()
    body = response.json()
    return body if isinstance(body, list) else []


def _download_public(job_id: str, name: str) -> bytes | None:
    if name not in ARTIFACT_NAMES:
        return None
    return _download(f"{job_id}/{name}")


def fetch_remote_artifact(job_id: str, name: str) -> bytes | None:
    return _download_public(job_id, name)


def _service_headers() -> dict:
    key = settings.supabase_secret
    return {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}


def _supabase_reachable() -> bool:
    try:
        _select("jobs", {"select": "id", "limit": "1"})
    except Exception:
        return False
    return True


def _modal_reachable() -> bool:
    try:
        import modal

        modal.Function.from_name("drafty-engineering", "run_simulation")
    except Exception:
        return False
    return True


def _modal_tested() -> bool:
    try:
        rows = _select("jobs", {"compute": "eq.modal", "status": "eq.completed", "select": "id", "limit": "1"})
    except Exception:
        return False
    return bool(rows)


def _api_origin() -> str:
    explicit = os.getenv("DRAFTY_API_ORIGIN", "").strip().rstrip("/")
    if explicit:
        return explicit
    vercel = os.getenv("VERCEL_URL", "").strip()
    if vercel:
        return f"https://{vercel}"
    production = os.getenv("VERCEL_PROJECT_PRODUCTION_URL", "").strip()
    if production:
        return f"https://{production}"
    return ""


def _cancel_call(call: object) -> None:
    cancel = getattr(call, "cancel", None)
    if cancel is None:
        return
    try:
        cancel()
    except Exception:
        return


def _uuid(value: str) -> None:
    try:
        if str(uuid.UUID(value)) != value:
            raise ValueError
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Job not found.") from exc


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_time(value: str) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed
