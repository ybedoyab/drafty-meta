"""Production-style cleanup, geometry cache integrity, and distributed preview quotas."""

from __future__ import annotations

import json
import threading
import time
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from drafty_api.geometry_cache import (
    GENERATOR_REVISION,
    GEOMETRY_NAMES,
    MANIFEST_NAME,
    GeometryPending,
    build_manifest,
    load_or_build_geometry,
    profile_digest,
    read_local_cache,
    write_local_cache,
    write_remote_cache,
)
from drafty_api.jobs import charge_preview
from drafty_api.main import app
from drafty_api.settings import settings
from drafty_engineering.revolved import proposed_geometry_spec
from drafty_engineering.spec import RevolvedProfile


def _profile() -> RevolvedProfile:
    return RevolvedProfile.model_validate(
        proposed_geometry_spec({"overall_height_m": 0.05, "base_diameter_m": 0.028})["profile"]
    )


def _fake_files(digest: str) -> dict[str, bytes]:
    return {name: f"{digest}-{name}".encode() * 40 for name in GEOMETRY_NAMES}


def _enable_production_auth(monkeypatch, owner: str = "local") -> None:
    monkeypatch.setattr(settings, "drafty_env", "production")
    monkeypatch.setattr(settings, "drafty_auth_mode", "supabase")
    monkeypatch.setattr(settings, "supabase_url", "https://example.supabase.co")
    monkeypatch.setattr(settings, "supabase_secret_key", "service-role")
    monkeypatch.setattr(settings, "supabase_publishable_key", "publishable")
    monkeypatch.setattr("drafty_api.scenarios.current_owner", lambda _request: owner)
    monkeypatch.setattr("drafty_api.scenarios.current_access_token", lambda: "token")
    monkeypatch.setattr("drafty_ai.scenario_agent.configured", lambda: False)
    monkeypatch.setattr("drafty_api.scenarios.configured", lambda: False)


def test_cache_keys_include_generator_revision(monkeypatch):
    profile = _profile()
    digest = profile_digest(profile)
    assert len(digest) == 64
    without_revision = __import__("hashlib").sha256(profile.model_dump_json().encode()).hexdigest()
    assert digest != without_revision
    monkeypatch.setattr("drafty_api.geometry_cache.GENERATOR_REVISION", f"{GENERATOR_REVISION}-bump")
    bumped = profile_digest(profile)
    assert bumped != digest


def test_write_remote_cache_uploads_files_before_manifest_and_rejects_partial(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "drafty_data_dir", str(tmp_path))
    monkeypatch.setattr(settings, "supabase_url", "https://example.supabase.co")
    monkeypatch.setattr(settings, "supabase_secret_key", "service-role")
    digest = "a" * 64
    files = _fake_files(digest)
    uploaded: list[str] = []

    def _upload(path: str, data: bytes, content_type: str) -> bool:
        uploaded.append(path)
        if path.endswith("model.stl"):
            return False
        return True

    monkeypatch.setattr("drafty_api.storage.upload_private_object_if_absent", _upload)
    monkeypatch.setattr("drafty_api.storage.private_object_exists", lambda path: False)

    with pytest.raises(HTTPException) as exc:
        write_remote_cache(digest, files)
    assert exc.value.status_code == 503
    assert any(path.endswith("model.step") for path in uploaded)
    assert not any(path.endswith(MANIFEST_NAME) for path in uploaded)


def test_write_remote_cache_verifies_uploads_then_publishes_manifest(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "drafty_data_dir", str(tmp_path))
    monkeypatch.setattr(settings, "supabase_url", "https://example.supabase.co")
    monkeypatch.setattr(settings, "supabase_secret_key", "service-role")
    digest = "b" * 64
    files = _fake_files(digest)
    store: dict[str, bytes] = {}
    order: list[str] = []

    def _upload(path: str, data: bytes, content_type: str) -> bool:
        store[path] = data
        order.append(path)
        return True

    def _exists(path: str) -> bool:
        return path in store

    monkeypatch.setattr("drafty_api.storage.upload_private_object_if_absent", _upload)
    monkeypatch.setattr("drafty_api.storage.private_object_exists", _exists)

    write_remote_cache(digest, files)
    assert order[-1].endswith(MANIFEST_NAME)
    assert all(any(item.endswith(name) for item in order[:-1]) for name in GEOMETRY_NAMES)
    manifest = json.loads(store[f"geometry/{digest}/{MANIFEST_NAME}"].decode())
    assert manifest["digest"] == digest
    assert manifest["generator_revision"] == GENERATOR_REVISION


@pytest.mark.cad
def test_geometry_cache_race_only_builds_once(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "drafty_data_dir", str(tmp_path))
    monkeypatch.setattr(settings, "drafty_env", "development")
    monkeypatch.setattr(settings, "drafty_max_previews_per_hour", 100)
    profile = _profile()
    builds = {"count": 0}
    real_export = __import__("drafty_api.geometry_cache", fromlist=["_export_local"])._export_local

    def _slow_export(prof):
        builds["count"] += 1
        time.sleep(0.15)
        return real_export(prof)

    monkeypatch.setattr("drafty_api.geometry_cache._export_local", _slow_export)
    results: list[tuple[bool, bytes]] = []
    errors: list[BaseException] = []
    start = threading.Barrier(2)

    def _worker():
        try:
            start.wait(timeout=5)
            files, hit = load_or_build_geometry(profile, "race-owner")
            results.append((hit, files["model.stl"]))
        except BaseException as exc:  # noqa: BLE001 - collect for assertion
            errors.append(exc)

    threads = [threading.Thread(target=_worker) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=60)
    assert not errors
    assert builds["count"] == 1
    assert len(results) == 2
    assert results[0][1] == results[1][1]
    assert sum(1 for hit, _ in results if hit) == 1
    assert sum(1 for hit, _ in results if not hit) == 1


def test_production_remote_cleanup_purges_jobs_storage_and_retains_geometry(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "drafty_data_dir", str(tmp_path))
    _enable_production_auth(monkeypatch)

    scenario_id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    job_id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    owner = "local"
    geometry_path = f"geometry/{'c' * 64}/model.stl"
    deleted_paths: list[str] = []
    cancelled: list[str] = []
    purged: list[str] = []

    session = {
        "id": scenario_id,
        "owner_id": owner,
        "name": "Cleanup",
        "version": 1,
        "inputs": {},
        "messages": [],
        "evidence": [{"id": "ev1", "media_type": "image/png"}],
        "jobs": [{"id": job_id, "kind": "simulation"}],
        "created_at": "2026-01-01T00:00:00+00:00",
        "updated_at": "2026-01-01T00:00:00+00:00",
    }
    session_dir = Path(tmp_path) / "scenarios" / scenario_id
    session_dir.mkdir(parents=True)
    (session_dir / "session.json").write_text(json.dumps(session), encoding="utf-8")
    job_dir = Path(tmp_path) / "jobs" / job_id
    job_dir.mkdir(parents=True)
    (job_dir / "job.json").write_text(
        json.dumps(
            {
                "id": job_id,
                "owner_id": owner,
                "kind": "simulation",
                "status": "running",
                "message": "Solving",
                "scenario_id": scenario_id,
                "spec": {},
                "options": {},
                "created_at": "2026-01-01T00:00:00+00:00",
                "updated_at": "2026-01-01T00:00:00+00:00",
            }
        ),
        encoding="utf-8",
    )

    def _delete_object(path: str) -> bool:
        deleted_paths.append(path)
        assert not path.startswith("geometry/"), "geometry cache must not be deleted"
        return True

    def _list_jobs(sid: str, oid: str) -> list[dict]:
        assert sid == scenario_id and oid == owner
        return [{"id": job_id, "owner_id": owner, "status": "running", "scenario_id": scenario_id}]

    def _purge(jid: str, oid: str) -> dict:
        purged.append(jid)
        deleted_paths.append(f"{jid}/results.json")
        return {
            "job_id": jid,
            "cancelled": True,
            "storage_removed": 1,
            "row_deleted": True,
            "errors": [f"refused:{geometry_path}"],
        }

    def _cancel(jid: str, oid: str) -> dict:
        cancelled.append(jid)
        return {"id": jid, "status": "cancel_requested"}

    def _delete_scenario(*_args, **_kwargs) -> bool:
        return True

    monkeypatch.setattr("drafty_api.scenarios._remote_session", lambda sid, oid: dict(session))
    monkeypatch.setattr("drafty_api.scenarios.delete_private_object", _delete_object)
    monkeypatch.setattr("drafty_api.remote.list_remote_jobs_for_scenario", _list_jobs)
    monkeypatch.setattr("drafty_api.remote.purge_remote_job", _purge)
    monkeypatch.setattr("drafty_api.jobs.request_cancel", _cancel)
    monkeypatch.setattr("drafty_api.scenarios.delete_remote_scenario", _delete_scenario)

    with TestClient(app) as client:
        deleted = client.delete(f"/api/v1/scenarios/{scenario_id}")
    assert deleted.status_code == 200
    body = deleted.json()
    assert body["cleanup"]["geometry_cache"] == "retained"
    assert body["cleanup"]["remote_jobs_purged"] == 1
    assert body["cleanup"]["fem_storage_removed"] == 1
    assert body["cleanup"]["errors"] == []
    assert job_id in cancelled
    assert job_id in purged
    assert any(path.startswith("evidence/") for path in deleted_paths)
    assert not job_dir.exists()
    assert not session_dir.exists()


def test_cleanup_partial_failure_is_retryable_before_scenario_row_delete(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "drafty_data_dir", str(tmp_path))
    _enable_production_auth(monkeypatch)

    scenario_id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
    job_id = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
    owner = "local"
    session = {
        "id": scenario_id,
        "owner_id": owner,
        "name": "Retry",
        "version": 1,
        "inputs": {},
        "messages": [],
        "evidence": [],
        "jobs": [{"id": job_id, "kind": "simulation"}],
        "created_at": "2026-01-01T00:00:00+00:00",
        "updated_at": "2026-01-01T00:00:00+00:00",
    }
    session_dir = Path(tmp_path) / "scenarios" / scenario_id
    session_dir.mkdir(parents=True)
    (session_dir / "session.json").write_text(json.dumps(session), encoding="utf-8")
    scenario_deleted = {"count": 0}
    attempts = {"purge": 0}

    def _purge(jid: str, oid: str) -> dict:
        attempts["purge"] += 1
        if attempts["purge"] == 1:
            return {
                "job_id": jid,
                "cancelled": True,
                "storage_removed": 0,
                "row_deleted": False,
                "errors": [f"{jid}/results.json"],
            }
        return {
            "job_id": jid,
            "cancelled": False,
            "storage_removed": 1,
            "row_deleted": True,
            "errors": [],
        }

    def _cancel_job(*_a, **_k):
        return {"status": "cancelled"}

    def _delete_remote(*_a, **_k):
        scenario_deleted["count"] += 1
        return True

    def _list_empty(*_a, **_k):
        return []

    def _delete_ok(*_a, **_k):
        return True

    monkeypatch.setattr("drafty_api.scenarios._remote_session", lambda sid, oid: dict(session))
    monkeypatch.setattr("drafty_api.remote.list_remote_jobs_for_scenario", _list_empty)
    monkeypatch.setattr("drafty_api.remote.purge_remote_job", _purge)
    monkeypatch.setattr("drafty_api.jobs.request_cancel", _cancel_job)
    monkeypatch.setattr("drafty_api.scenarios.delete_remote_scenario", _delete_remote)
    monkeypatch.setattr("drafty_api.scenarios.delete_private_object", _delete_ok)

    with TestClient(app) as client:
        first = client.delete(f"/api/v1/scenarios/{scenario_id}")
        assert first.status_code == 503
        assert scenario_deleted["count"] == 0
        assert session_dir.exists()
        second = client.delete(f"/api/v1/scenarios/{scenario_id}")
    assert second.status_code == 200
    assert scenario_deleted["count"] == 1
    assert second.json()["cleanup"]["errors"] == []


def test_production_quota_fails_closed_when_backend_unavailable(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "drafty_data_dir", str(tmp_path))
    monkeypatch.setattr(settings, "drafty_env", "production")
    monkeypatch.setattr(settings, "supabase_url", "")
    monkeypatch.setattr(settings, "supabase_secret_key", "")
    with pytest.raises(HTTPException) as exc:
        charge_preview("owner-x")
    assert exc.value.status_code == 503

    monkeypatch.setattr(settings, "supabase_url", "https://example.supabase.co")
    monkeypatch.setattr(settings, "supabase_secret_key", "service-role")

    def _unavailable(*_a, **_k):
        return None

    monkeypatch.setattr("drafty_api.storage.charge_preview_quota_remote", _unavailable)
    with pytest.raises(HTTPException) as exc2:
        charge_preview("owner-x")
    assert exc2.value.status_code == 503


def test_concurrent_quota_enforcement_allows_only_limit(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "drafty_data_dir", str(tmp_path))
    monkeypatch.setattr(settings, "drafty_env", "production")
    monkeypatch.setattr(settings, "supabase_url", "https://example.supabase.co")
    monkeypatch.setattr(settings, "supabase_secret_key", "service-role")
    monkeypatch.setattr(settings, "drafty_max_previews_per_hour", 3)

    lock = threading.Lock()
    charged = {"n": 0}

    def _rpc(owner_id: str, limit: int) -> bool:
        with lock:
            if charged["n"] >= limit:
                return False
            charged["n"] += 1
            return True

    monkeypatch.setattr("drafty_api.storage.charge_preview_quota_remote", _rpc)
    results: list[int] = []
    barrier = threading.Barrier(8)

    def _worker():
        barrier.wait(timeout=5)
        try:
            charge_preview("shared-owner")
            results.append(200)
        except HTTPException as exc:
            results.append(exc.status_code)

    threads = [threading.Thread(target=_worker) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=10)
    assert results.count(200) == 3
    assert results.count(429) == 5
    assert charged["n"] == 3


def test_local_manifest_includes_generator_revision(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "drafty_data_dir", str(tmp_path))
    digest = "d" * 64
    files = _fake_files(digest)
    write_local_cache(digest, files)
    cached = read_local_cache(digest)
    assert cached is not None
    manifest = build_manifest(files, digest)
    assert manifest["generator_revision"] == GENERATOR_REVISION
    on_disk = json.loads((Path(tmp_path) / "geometry" / digest / MANIFEST_NAME).read_text(encoding="utf-8"))
    assert on_disk["generator_revision"] == GENERATOR_REVISION


def test_purge_remote_job_keeps_row_when_storage_delete_fails(monkeypatch):
    from drafty_api.remote import purge_remote_job

    job_id = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
    owner = "owner-purge"
    monkeypatch.setattr(settings, "supabase_url", "https://example.supabase.co")
    monkeypatch.setattr(settings, "supabase_secret_key", "service-role")
    deleted_rows = {"count": 0}

    def _select(table, params):
        if table == "jobs":
            return [{"id": job_id, "owner_id": owner, "status": "completed"}]
        if table == "artifacts":
            return [{"name": "results.json", "storage_path": f"{job_id}/results.json"}]
        return []

    def _delete_objects(paths):
        return 0, [f"{job_id}/results.json"]

    def _httpx_delete(*_a, **_k):
        deleted_rows["count"] += 1
        raise AssertionError("job row must not be deleted while storage cleanup failed")

    monkeypatch.setattr("drafty_api.remote._select", _select)
    monkeypatch.setattr("drafty_api.storage.delete_private_objects", _delete_objects)
    monkeypatch.setattr("drafty_api.remote.httpx.delete", _httpx_delete)

    first = purge_remote_job(job_id, owner)
    assert first["row_deleted"] is False
    assert first["retryable"] is True
    assert first["errors"] == [f"{job_id}/results.json"]
    assert deleted_rows["count"] == 0

    remaining = {"paths": [f"{job_id}/results.json"]}

    def _delete_retry(paths):
        removed = list(remaining["paths"])
        remaining["paths"] = []
        return len(removed), []

    row_deleted = {"ok": False}

    class _Response:
        status_code = 204

    def _httpx_delete_ok(*_a, **_k):
        row_deleted["ok"] = True
        return _Response()

    monkeypatch.setattr("drafty_api.storage.delete_private_objects", _delete_retry)
    monkeypatch.setattr("drafty_api.remote.httpx.delete", _httpx_delete_ok)
    second = purge_remote_job(job_id, owner)
    assert second["row_deleted"] is True
    assert second["retryable"] is False
    assert second["errors"] == []
    assert remaining["paths"] == []
    assert row_deleted["ok"] is True


class _FakeGeometryBuilds:
    """In-memory stand-in for migration 0008/0009 geometry_build RPCs."""

    def __init__(self) -> None:
        self.rows: dict[str, dict] = {}
        self.lock = threading.Lock()

    def get(self, digest: str) -> dict | None:
        with self.lock:
            row = self.rows.get(digest)
            return dict(row) if row else None

    def claim_start(
        self,
        digest: str,
        owner: str,
        profile: dict | None = None,
        stale_after_seconds: int = 600,
        resume_after_seconds: int = 45,
    ) -> dict:
        del stale_after_seconds
        with self.lock:
            row = self.rows.get(digest)
            now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            if row is None:
                row = {
                    "digest": digest,
                    "owner_id": owner,
                    "status": "queued",
                    "modal_call_id": None,
                    "profile": profile or {},
                    "error": None,
                    "charged": False,
                    "created_at": now,
                    "updated_at": now,
                }
                self.rows[digest] = row
                return {"claimed": True, **row}
            if row["status"] == "completed":
                return {"claimed": False, **row}
            if row["status"] in {"queued", "running"} and row.get("modal_call_id"):
                return {"claimed": False, **row}
            if row["status"] == "queued" and not row.get("modal_call_id"):
                updated = str(row.get("updated_at") or "")
                # Mirror SQL resume_after: only resume when the row looks abandoned.
                resume_ready = bool(row.pop("_force_resume", False))
                if not resume_ready and updated.endswith("Z"):
                    try:
                        age = time.time() - time.mktime(time.strptime(updated, "%Y-%m-%dT%H:%M:%SZ"))
                        resume_ready = age > resume_after_seconds
                    except ValueError:
                        resume_ready = True
                if not resume_ready:
                    return {"claimed": False, **row}
                row["owner_id"] = owner
                row["profile"] = profile or row.get("profile") or {}
                row["error"] = None
                row["updated_at"] = now
                return {"claimed": True, **row}
            row.update(
                {
                    "owner_id": owner,
                    "status": "queued",
                    "modal_call_id": None,
                    "profile": profile or {},
                    "error": None,
                    "charged": False,
                    "updated_at": now,
                }
            )
            return {"claimed": True, **row}

    def mark_charged(self, digest: str) -> bool:
        with self.lock:
            row = self.rows.get(digest)
            if not row or row["status"] != "queued":
                return False
            row["charged"] = True
            row["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            return True

    def attach(self, digest: str, call_id: str) -> bool:
        with self.lock:
            row = self.rows.get(digest)
            if not row:
                return False
            if row.get("modal_call_id"):
                return row["modal_call_id"] == call_id and row["status"] in {"queued", "running"}
            if row["status"] != "queued":
                return False
            row["status"] = "running"
            row["modal_call_id"] = call_id
            row["error"] = None
            row["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            return True

    def transition(self, digest: str, from_statuses: list[str], to_status: str, error: str | None = None) -> bool:
        with self.lock:
            row = self.rows.get(digest)
            if not row or row["status"] not in from_statuses:
                return False
            row["status"] = to_status
            row["error"] = error if to_status == "failed" else None
            row["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            return True


def _install_fake_builds(monkeypatch, store: _FakeGeometryBuilds) -> None:
    monkeypatch.setattr("drafty_api.geometry_cache._remote_build_row", store.get)
    monkeypatch.setattr("drafty_api.geometry_cache._claim_build_start", store.claim_start)
    monkeypatch.setattr("drafty_api.geometry_cache._mark_build_charged", store.mark_charged)
    monkeypatch.setattr("drafty_api.geometry_cache._attach_build_call", store.attach)
    monkeypatch.setattr("drafty_api.geometry_cache._transition_build", store.transition)


def test_geometry_lock_contention_returns_retryable_without_modal(tmp_path, monkeypatch):
    from drafty_api.geometry_cache import GeometryPending, load_or_build_geometry

    monkeypatch.setattr(settings, "drafty_data_dir", str(tmp_path))
    monkeypatch.setattr(settings, "drafty_env", "production")
    monkeypatch.setattr(settings, "supabase_url", "https://example.supabase.co")
    monkeypatch.setattr(settings, "supabase_secret_key", "service-role")
    profile = _profile()
    digest = profile_digest(profile)
    store = _FakeGeometryBuilds()
    fresh = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    store.rows[digest] = {
        "digest": digest,
        "owner_id": "other",
        "status": "running",
        "modal_call_id": "fc-other",
        "profile": {},
        "error": None,
        "charged": True,
        "created_at": fresh,
        "updated_at": fresh,
    }
    modal_calls = {"n": 0}

    def _spawn(_profile):
        modal_calls["n"] += 1
        raise AssertionError("Modal must not start when another instance owns the build")

    monkeypatch.setattr("drafty_api.geometry_cache.read_remote_cache", lambda *_a, **_k: None)
    monkeypatch.setattr("drafty_api.remote.spawn_remote_geometry", _spawn)
    monkeypatch.setattr("drafty_api.remote.poll_remote_geometry", lambda *_a, **_k: None)
    _install_fake_builds(monkeypatch, store)

    with pytest.raises(GeometryPending) as pending:
        load_or_build_geometry(profile, "owner-lock")
    assert pending.value.status == "running"
    assert modal_calls["n"] == 0


def test_geometry_lock_backend_unavailable_fails_closed(tmp_path, monkeypatch):
    from drafty_api.geometry_cache import load_or_build_geometry

    monkeypatch.setattr(settings, "drafty_data_dir", str(tmp_path))
    monkeypatch.setattr(settings, "drafty_env", "production")
    monkeypatch.setattr(settings, "supabase_url", "https://example.supabase.co")
    monkeypatch.setattr(settings, "supabase_secret_key", "service-role")
    profile = _profile()
    monkeypatch.setattr("drafty_api.geometry_cache.read_remote_cache", lambda *_a, **_k: None)
    monkeypatch.setattr("drafty_api.geometry_cache._remote_build_row", lambda *_a, **_k: None)
    monkeypatch.setattr("drafty_api.geometry_cache._claim_build_start", lambda *_a, **_k: None)
    with pytest.raises(HTTPException) as exc:
        load_or_build_geometry(profile, "owner-lock")
    assert exc.value.status_code == 503
    assert "unavailable" in str(exc.value.detail).lower()


def test_production_geometry_miss_spawns_async_without_sync_wait(tmp_path, monkeypatch):
    """Quota charges once, Modal is spawned, and the HTTP path stays pending (no cancel)."""

    monkeypatch.setattr(settings, "drafty_data_dir", str(tmp_path))
    monkeypatch.setattr(settings, "drafty_env", "production")
    monkeypatch.setattr(settings, "supabase_url", "https://example.supabase.co")
    monkeypatch.setattr(settings, "supabase_secret_key", "service-role")
    profile = _profile()
    digest = profile_digest(profile)
    store = _FakeGeometryBuilds()
    charges = {"n": 0}
    spawns = {"n": 0, "id": "fc-geometry-1"}
    polls = {"n": 0}

    monkeypatch.setattr("drafty_api.geometry_cache.read_remote_cache", lambda *_a, **_k: None)

    def _charge(_owner: str) -> None:
        charges["n"] += 1

    def _spawn(_profile: dict) -> str:
        spawns["n"] += 1
        return str(spawns["id"])

    def _poll(_call_id: str, timeout: float = 0):
        polls["n"] += 1
        if polls["n"] == 1:
            return None
        return _fake_files(digest)

    monkeypatch.setattr("drafty_api.jobs.charge_preview", _charge)
    monkeypatch.setattr("drafty_api.remote.spawn_remote_geometry", _spawn)
    monkeypatch.setattr("drafty_api.remote.poll_remote_geometry", _poll)
    monkeypatch.setattr("drafty_api.geometry_cache.write_remote_cache", lambda *_a, **_k: None)
    _install_fake_builds(monkeypatch, store)

    with pytest.raises(GeometryPending) as pending:
        load_or_build_geometry(profile, "owner-async")
    assert pending.value.digest == digest
    assert pending.value.status == "running"
    assert charges["n"] == 1
    assert spawns["n"] == 1
    assert store.rows[digest]["modal_call_id"] == "fc-geometry-1"
    assert store.rows[digest]["charged"] is True

    with pytest.raises(GeometryPending):
        load_or_build_geometry(profile, "owner-async")
    assert charges["n"] == 1
    assert spawns["n"] == 1
    assert polls["n"] == 1

    files, hit = load_or_build_geometry(profile, "owner-async")
    assert hit is False
    assert files["preview.glb"].startswith(digest.encode())
    assert store.rows[digest]["status"] == "completed"
    assert charges["n"] == 1
    assert spawns["n"] == 1
    assert polls["n"] == 2
    assert read_local_cache(digest) is not None


def test_geometry_charge_persists_before_spawn_and_survives_attach_failure(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "drafty_data_dir", str(tmp_path))
    monkeypatch.setattr(settings, "drafty_env", "production")
    monkeypatch.setattr(settings, "supabase_url", "https://example.supabase.co")
    monkeypatch.setattr(settings, "supabase_secret_key", "service-role")
    profile = _profile()
    digest = profile_digest(profile)
    store = _FakeGeometryBuilds()
    charges = {"n": 0}
    spawns: list[str] = []
    cancels: list[str] = []

    def _charge(_owner: str) -> None:
        charges["n"] += 1

    def _spawn(_profile: dict) -> str:
        call_id = f"fc-{len(spawns) + 1}"
        spawns.append(call_id)
        return call_id

    monkeypatch.setattr("drafty_api.geometry_cache.read_remote_cache", lambda *_a, **_k: None)
    monkeypatch.setattr("drafty_api.jobs.charge_preview", _charge)
    monkeypatch.setattr("drafty_api.remote.spawn_remote_geometry", _spawn)
    monkeypatch.setattr("drafty_api.remote.cancel_remote_geometry_call", lambda call_id: cancels.append(call_id))
    _install_fake_builds(monkeypatch, store)
    monkeypatch.setattr("drafty_api.geometry_cache._attach_build_call", lambda *_a, **_k: False)

    with pytest.raises(HTTPException) as exc:
        load_or_build_geometry(profile, "owner-partial")
    assert exc.value.status_code == 503
    assert charges["n"] == 1
    assert spawns == ["fc-1"]
    assert cancels == ["fc-1"]
    assert store.rows[digest]["charged"] is True
    assert store.rows[digest]["status"] == "queued"
    assert store.rows[digest]["modal_call_id"] is None

    # Resume after the crash-window grace: already charged, spawn again, no second charge.
    store.rows[digest]["_force_resume"] = True
    monkeypatch.setattr("drafty_api.geometry_cache._attach_build_call", store.attach)
    with pytest.raises(GeometryPending):
        load_or_build_geometry(profile, "owner-partial")
    assert charges["n"] == 1
    assert spawns == ["fc-1", "fc-2"]
    assert store.rows[digest]["modal_call_id"] == "fc-2"
    assert store.rows[digest]["status"] == "running"


def test_concurrent_geometry_pollers_do_not_overwrite_terminal_state(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "drafty_data_dir", str(tmp_path))
    monkeypatch.setattr(settings, "drafty_env", "production")
    monkeypatch.setattr(settings, "supabase_url", "https://example.supabase.co")
    monkeypatch.setattr(settings, "supabase_secret_key", "service-role")
    profile = _profile()
    digest = profile_digest(profile)
    store = _FakeGeometryBuilds()
    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    store.rows[digest] = {
        "digest": digest,
        "owner_id": "owner",
        "status": "running",
        "modal_call_id": "fc-shared",
        "profile": {},
        "error": None,
        "charged": True,
        "created_at": now,
        "updated_at": now,
    }
    barrier = threading.Barrier(2)
    results: list[object] = []

    def _poll(_call_id: str, timeout: float = 0):
        barrier.wait(timeout=5)
        return _fake_files(digest)

    monkeypatch.setattr("drafty_api.geometry_cache.read_remote_cache", lambda *_a, **_k: None)
    monkeypatch.setattr("drafty_api.remote.poll_remote_geometry", _poll)
    monkeypatch.setattr("drafty_api.geometry_cache.write_remote_cache", lambda *_a, **_k: None)
    _install_fake_builds(monkeypatch, store)

    def _worker() -> None:
        try:
            results.append(load_or_build_geometry(profile, "owner"))
        except Exception as exc:  # noqa: BLE001 - collect either outcome
            results.append(exc)

    threads = [threading.Thread(target=_worker) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=10)
    assert len(results) == 2
    assert store.rows[digest]["status"] == "completed"
    assert store.rows[digest]["error"] is None
    assert all(
        (isinstance(item, tuple) and item[0]["preview.glb"].startswith(digest.encode()))
        or isinstance(item, GeometryPending)
        for item in results
    )
    assert any(isinstance(item, tuple) for item in results)


def test_geometry_spawn_failure_marks_build_failed_without_call_id(tmp_path, monkeypatch):
    """Charged+queued must not linger when Modal never returns a FunctionCall id."""

    monkeypatch.setattr(settings, "drafty_data_dir", str(tmp_path))
    monkeypatch.setattr(settings, "drafty_env", "production")
    monkeypatch.setattr(settings, "supabase_url", "https://example.supabase.co")
    monkeypatch.setattr(settings, "supabase_secret_key", "service-role")
    profile = _profile()
    digest = profile_digest(profile)
    store = _FakeGeometryBuilds()
    charges = {"n": 0}

    def _charge(_owner: str) -> None:
        charges["n"] += 1

    def _spawn(_profile: dict) -> str:
        raise HTTPException(
            status_code=502,
            detail=(
                "Modal function 'generate_revolved' was not found on app "
                "'drafty-engineering'. Redeploy the Modal app, then retry."
            ),
        )

    monkeypatch.setattr("drafty_api.geometry_cache.read_remote_cache", lambda *_a, **_k: None)
    monkeypatch.setattr("drafty_api.jobs.charge_preview", _charge)
    monkeypatch.setattr("drafty_api.remote.spawn_remote_geometry", _spawn)
    _install_fake_builds(monkeypatch, store)

    with pytest.raises(HTTPException) as exc:
        load_or_build_geometry(profile, "owner-spawn-fail")
    assert exc.value.status_code == 502
    assert "generate_revolved" in str(exc.value.detail).lower()
    assert charges["n"] == 1
    assert store.rows[digest]["charged"] is True
    assert store.rows[digest]["status"] == "failed"
    assert store.rows[digest]["modal_call_id"] is None
    assert "generate_revolved" in str(store.rows[digest]["error"]).lower()


def test_stale_geometry_build_fails_without_new_modal_spawn(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "drafty_data_dir", str(tmp_path))
    monkeypatch.setattr(settings, "drafty_env", "production")
    monkeypatch.setattr(settings, "supabase_url", "https://example.supabase.co")
    monkeypatch.setattr(settings, "supabase_secret_key", "service-role")
    profile = _profile()
    digest = profile_digest(profile)
    store = _FakeGeometryBuilds()
    store.rows[digest] = {
        "digest": digest,
        "owner_id": "owner",
        "status": "running",
        "modal_call_id": "fc-stale",
        "profile": {},
        "error": None,
        "charged": True,
        "created_at": "2026-11-04T00:00:00+00:00",
        "updated_at": "2026-11-04T00:00:00+00:00",
    }
    spawns = {"n": 0}

    monkeypatch.setattr("drafty_api.geometry_cache.read_remote_cache", lambda *_a, **_k: None)
    monkeypatch.setattr("drafty_api.geometry_cache.GEOMETRY_BUILD_STALE_AFTER_S", 60)
    monkeypatch.setattr(
        "drafty_api.remote.spawn_remote_geometry",
        lambda *_a, **_k: (_ for _ in ()).throw(AssertionError("no spawn")),
    )
    monkeypatch.setattr(
        "drafty_api.remote.poll_remote_geometry",
        lambda *_a, **_k: (_ for _ in ()).throw(AssertionError("no poll on stale")),
    )
    _install_fake_builds(monkeypatch, store)

    with pytest.raises(HTTPException) as exc:
        load_or_build_geometry(profile, "owner")
    assert exc.value.status_code == 503
    assert "timed out" in str(exc.value.detail).lower()
    assert store.rows[digest]["status"] == "failed"
    assert spawns["n"] == 0
