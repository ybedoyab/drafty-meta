"""Report downloads must survive serverless restarts via durable Storage."""

from __future__ import annotations

import json

from fastapi.testclient import TestClient

from drafty_api.jobs import create_job, job_dir
from drafty_api.main import app
from drafty_api.settings import settings
from drafty_engineering.report import build_report_from_parts
from drafty_engineering.spec import cantilever_benchmark_spec

OWNER = "report-owner"


def _solver_results() -> dict:
    return {
        "solver": {"name": "CalculiX", "version": "CalculiX test"},
        "mesh": {"nodes": 12, "elements": 4, "element_type": "C3D10"},
        "mass_kg": 0.5652,
        "max_displacement_m": 0.001,
        "max_von_mises_pa": 1.0,
        "governing_von_mises_pa": 1.0,
        "safety_factor": 2.0,
        "validation_status": "solver_completed",
        "equilibrium": {"passed": True},
        "warnings": [],
        "stress_assessment": {"safety_factor_status": "exploratory"},
    }


def test_build_report_from_parts_matches_directory_report(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "drafty_data_dir", str(tmp_path))
    monkeypatch.setattr(settings, "drafty_spawn_local", "never")
    job = create_job(OWNER, "simulation", cantilever_benchmark_spec().model_dump())
    directory = job_dir(job["id"])
    (directory / "results.json").write_text(json.dumps(_solver_results()), encoding="utf-8")
    from drafty_engineering.report import build_report

    local = build_report(directory)
    rebuilt = build_report_from_parts(
        json.loads((directory / "job.json").read_text(encoding="utf-8")),
        _solver_results(),
    )
    assert rebuilt["mass_kg"] == local["mass_kg"]
    assert rebuilt["solver"]["name"] == "CalculiX"
    assert rebuilt["report"] == "drafty-engineering"


def test_report_download_uses_stored_report_json_without_local_job_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "drafty_data_dir", str(tmp_path))
    monkeypatch.setattr(settings, "drafty_spawn_local", "never")
    monkeypatch.setattr(settings, "drafty_auth_mode", "dev")
    job = create_job(OWNER, "simulation", cantilever_benchmark_spec().model_dump())
    job_id = job["id"]
    directory = job_dir(job_id)
    results = _solver_results()
    (directory / "results.json").write_text(json.dumps(results), encoding="utf-8")
    from drafty_engineering.report import build_report

    report = build_report(directory)
    # Simulate a cold Vercel instance: wipe the ephemeral job directory.
    for path in directory.iterdir():
        path.unlink()
    directory.rmdir()
    assert not job_dir(job_id).exists()

    remote = {
        "report.json": json.dumps(report).encode("utf-8"),
    }

    monkeypatch.setattr(
        "drafty_api.remote.fetch_remote_artifact",
        lambda job, name: remote.get(name),
    )
    monkeypatch.setattr(
        "drafty_api.main.read_job",
        lambda job_key, owner: {
            "id": job_id,
            "owner_id": OWNER,
            "status": "completed",
            "kind": "simulation",
            "artifact_storage": "supabase",
        },
    )

    client = TestClient(app)
    response = client.get(
        f"/api/v1/jobs/{job_id}/artifacts/report.json",
        headers={"X-Drafty-Owner": OWNER},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["report"] == "drafty-engineering"
    assert body["mass_kg"] == 0.5652
    assert "calculix" in json.dumps(body).lower()


def test_report_rebuilds_from_remote_job_and_results_after_restart(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "drafty_data_dir", str(tmp_path))
    monkeypatch.setattr(settings, "drafty_spawn_local", "never")
    monkeypatch.setattr(settings, "drafty_auth_mode", "dev")
    job = create_job(OWNER, "simulation", cantilever_benchmark_spec().model_dump())
    job_id = job["id"]
    directory = job_dir(job_id)
    job_payload = json.loads((directory / "job.json").read_text(encoding="utf-8"))
    results = _solver_results()
    # Cold start: no local files, and no prebuilt report.json in Storage.
    for path in directory.iterdir():
        path.unlink()
    directory.rmdir()

    remote = {
        "job.json": json.dumps(job_payload).encode("utf-8"),
        "results.json": json.dumps(results).encode("utf-8"),
    }
    monkeypatch.setattr(
        "drafty_api.remote.fetch_remote_artifact",
        lambda job, name: remote.get(name) if name != "job.json" else None,
    )
    monkeypatch.setattr(
        "drafty_api.storage.download_private_object",
        lambda path: remote.get(path.rsplit("/", 1)[-1]),
    )
    monkeypatch.setattr(
        "drafty_api.main.read_job",
        lambda job_key, owner: {
            "id": job_id,
            "owner_id": OWNER,
            "status": "completed",
            "kind": "simulation",
            "artifact_storage": "supabase",
        },
    )

    client = TestClient(app)
    headers = {"X-Drafty-Owner": OWNER}
    json_response = client.get(f"/api/v1/jobs/{job_id}/artifacts/report.json", headers=headers)
    assert json_response.status_code == 200
    body = json_response.json()
    assert body["mass_kg"] == 0.5652
    assert body["mesh"]["element_type"] == "C3D10"
    assert "supabase-storage" in body["generated_from"]

    pdf_response = client.get(f"/api/v1/jobs/{job_id}/artifacts/report.pdf", headers=headers)
    assert pdf_response.status_code == 200
    assert pdf_response.headers["content-type"].startswith("application/pdf")
    assert pdf_response.content.startswith(b"%PDF")
    assert b"0.5652" in pdf_response.content

    link = client.get(f"/api/v1/jobs/{job_id}/artifacts/report.pdf/link", headers=headers)
    assert link.status_code == 200
    assert link.json()["url"] is None


def test_report_404_when_remote_results_missing(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "drafty_data_dir", str(tmp_path))
    monkeypatch.setattr(settings, "drafty_spawn_local", "never")
    monkeypatch.setattr(settings, "drafty_auth_mode", "dev")
    job = create_job(OWNER, "simulation", cantilever_benchmark_spec().model_dump())
    job_id = job["id"]
    directory = job_dir(job_id)
    for path in directory.iterdir():
        path.unlink()
    directory.rmdir()

    monkeypatch.setattr("drafty_api.remote.fetch_remote_artifact", lambda job, name: None)
    monkeypatch.setattr(
        "drafty_api.main.read_job",
        lambda job_key, owner: {
            "id": job_id,
            "owner_id": OWNER,
            "status": "completed",
            "kind": "simulation",
            "artifact_storage": "supabase",
        },
    )
    client = TestClient(app)
    response = client.get(
        f"/api/v1/jobs/{job_id}/artifacts/report.json",
        headers={"X-Drafty-Owner": OWNER},
    )
    assert response.status_code == 404
