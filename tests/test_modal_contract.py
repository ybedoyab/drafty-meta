import hashlib
import json
import sys
import types
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from drafty_api.main import app
from drafty_api.settings import settings
from drafty_engineering.artifacts import build_manifest, verify_manifest
from drafty_engineering.errors import DraftyError
from drafty_engineering.spec import cantilever_benchmark_spec


def test_manifest_round_trip_and_rejected_names(tmp_path: Path):
    payload = b"step-bytes"
    (tmp_path / "model.step").write_bytes(payload)
    (tmp_path / "results.json").write_text("{}", encoding="utf-8")
    manifest = build_manifest(tmp_path, "11111111-1111-1111-1111-111111111111")
    assert {item["name"] for item in manifest} == {"model.step", "results.json"}
    step = next(item for item in manifest if item["name"] == "model.step")
    assert step["sha256"] == hashlib.sha256(payload).hexdigest()
    verify_manifest(tmp_path, manifest, "11111111-1111-1111-1111-111111111111")
    with pytest.raises(DraftyError):
        verify_manifest(
            tmp_path,
            [{"name": "../secret", "job_id": "11111111-1111-1111-1111-111111111111", "byte_length": 1, "sha256": "ab"}],
            "11111111-1111-1111-1111-111111111111",
        )


def test_duplicate_local_job_is_rejected_and_modal_stays_off(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "drafty_data_dir", str(tmp_path))
    monkeypatch.setattr(settings, "drafty_auth_mode", "disabled")
    monkeypatch.setattr(type(settings), "modal_available", property(lambda self: False))
    monkeypatch.setattr("drafty_api.jobs._spawn", lambda directory: None)
    spec = cantilever_benchmark_spec().model_dump()
    with TestClient(app) as client:
        first = client.post("/api/v1/jobs", json={"kind": "simulation", "spec": spec, "compute": "local"})
        second = client.post("/api/v1/jobs", json={"kind": "simulation", "spec": spec, "compute": "local"})
        modal = client.post("/api/v1/jobs", json={"kind": "simulation", "spec": spec, "compute": "modal"})
    assert first.status_code == 200
    assert first.json()["compute"] == "local"
    assert second.status_code == 409
    assert modal.status_code == 409
    assert "Local CalculiX was not started" in modal.json()["detail"]


def test_artifact_download_streams_and_rejects_an_oversize_file(tmp_path: Path, monkeypatch):
    class Volume:
        @staticmethod
        def from_name(name: str):
            assert name == "drafty-artifacts"
            return Volume()

        def read_file(self, key: str):
            assert key.endswith("/model.step")
            yield b"abcd"
            yield b"efgh"

    modal = types.ModuleType("modal")
    modal.Volume = Volume
    monkeypatch.setitem(sys.modules, "modal", modal)
    from drafty_api.executor import _download_modal_artifacts

    job_id = "11111111-1111-1111-1111-111111111111"
    _download_modal_artifacts(job_id, tmp_path, [{"name": "model.step"}], ("model.step",), 8)
    assert (tmp_path / "model.step").read_bytes() == b"abcdefgh"
    assert not (tmp_path / ".model.step.partial").exists()
    with pytest.raises(DraftyError, match="size limit"):
        _download_modal_artifacts(job_id, tmp_path, [{"name": "model.step"}], ("model.step",), 7)
    assert not (tmp_path / ".model.step.partial").exists()


def test_cancel_reaches_the_modal_function_call(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(settings, "drafty_data_dir", str(tmp_path))
    job_id = "22222222-2222-2222-2222-222222222222"
    directory = tmp_path / "jobs" / job_id
    directory.mkdir(parents=True)
    (directory / "job.json").write_text(
        json.dumps(
            {
                "id": job_id,
                "owner_id": "local",
                "status": "solving",
                "compute": "modal",
                "modal_call_id": "fc-remote",
            }
        ),
        encoding="utf-8",
    )
    seen: list[str] = []

    class Call:
        def cancel(self) -> None:
            seen.append("cancel")

    class FunctionCall:
        @staticmethod
        def from_id(call_id: str) -> Call:
            seen.append(call_id)
            return Call()

    modal = types.ModuleType("modal")
    modal.FunctionCall = FunctionCall
    monkeypatch.setitem(sys.modules, "modal", modal)
    from drafty_api.jobs import request_cancel

    request_cancel(job_id, "local")
    assert seen == ["fc-remote", "cancel"]
    assert (directory / "cancel").is_file()


def test_configured_modal_job_stays_queued_until_the_worker_starts(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "drafty_data_dir", str(tmp_path))
    monkeypatch.setattr(settings, "drafty_auth_mode", "disabled")
    monkeypatch.setattr(type(settings), "modal_available", property(lambda self: True))
    spawned: list[str] = []
    monkeypatch.setattr("drafty_api.jobs._spawn", lambda directory: spawned.append(directory.name))
    spec = cantilever_benchmark_spec().model_dump()
    with TestClient(app) as client:
        response = client.post("/api/v1/jobs", json={"kind": "simulation", "spec": spec, "compute": "modal"})
    assert response.status_code == 200
    body = response.json()
    assert body["compute"] == "modal"
    assert body["status"] == "queued"
    assert spawned == [body["id"]]
