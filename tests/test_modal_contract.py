import hashlib
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
