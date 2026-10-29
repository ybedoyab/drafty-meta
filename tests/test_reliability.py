import json

import pytest
from fastapi.testclient import TestClient

from drafty_api.images import inspect_image
from drafty_api.jobs import acquire_claim, create_job, read_job, recover_interrupted_jobs
from drafty_api.main import app
from drafty_api.settings import settings
from drafty_engineering.report import build_report, text_pdf
from drafty_engineering.spec import cantilever_benchmark_spec

PNG = bytes.fromhex(
    "89504e470d0a1a0a"
    "0000000d4948445200000001000000010802000000907753de"
    "0000000c4944415408d763f8cfc0000000030001c7e4e3d3"
    "0000000049454e44ae426082"
)


def test_png_dimensions_are_read_and_truncation_is_rejected():
    media, width, height = inspect_image(PNG)
    assert (media, width, height) == ("image/png", 1, 1)
    with pytest.raises(ValueError, match="IEND"):
        inspect_image(PNG[:24])


def test_a_second_worker_cannot_claim_the_same_job(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "drafty_data_dir", str(tmp_path))
    monkeypatch.setattr(settings, "drafty_spawn_local", "never")
    job = create_job("local", "simulation", cantilever_benchmark_spec().model_dump())
    from drafty_api.jobs import job_dir

    directory = job_dir(job["id"])
    assert acquire_claim(directory) is True
    assert acquire_claim(directory) is False
    assert not (directory / "worker.log").exists()


def test_a_stale_running_job_is_failed_on_recovery(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "drafty_data_dir", str(tmp_path))
    monkeypatch.setattr(settings, "drafty_spawn_local", "never")
    job = create_job("local", "simulation", cantilever_benchmark_spec().model_dump())
    from drafty_api.jobs import job_dir, update_job

    directory = job_dir(job["id"])
    update_job(directory, status="solving", heartbeat_at="2000-01-01T00:00:00+00:00")
    claim = directory / "claim"
    claim.write_text("dead", encoding="utf-8")
    import os
    import time

    os.utime(claim, (time.time() - 1000, time.time() - 1000))
    recover_interrupted_jobs()
    recovered = read_job(job["id"], "local")
    assert recovered["status"] == "failed"
    assert "worker stopped" in recovered["error"]


def test_concurrent_job_updates_keep_a_readable_record(tmp_path, monkeypatch):
    import threading

    monkeypatch.setattr(settings, "drafty_data_dir", str(tmp_path))
    monkeypatch.setattr(settings, "drafty_spawn_local", "never")
    job = create_job("local", "simulation", cantilever_benchmark_spec().model_dump())
    from drafty_api.jobs import job_dir, update_job

    directory = job_dir(job["id"])

    def write(status: str) -> None:
        for _ in range(40):
            update_job(directory, status=status, message=status)

    threads = [threading.Thread(target=write, args=(name,)) for name in ("solving", "meshing")]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    saved = json.loads((directory / "job.json").read_text(encoding="utf-8"))
    assert saved["status"] in {"solving", "meshing"}
    assert saved["message"] == saved["status"]


def test_preview_quota_blocks_the_second_request(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "drafty_data_dir", str(tmp_path))
    monkeypatch.setattr(settings, "drafty_max_previews_per_hour", 1)
    payload = cantilever_benchmark_spec().model_dump()
    with TestClient(app) as client:
        first = client.post("/api/v1/designs/preview", json=payload)
        second = client.post("/api/v1/designs/preview", json=payload)
    assert first.status_code == 200
    assert second.status_code == 429


def test_report_uses_only_saved_solver_fields(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "drafty_data_dir", str(tmp_path))
    monkeypatch.setattr(settings, "drafty_spawn_local", "never")
    job = create_job("local", "simulation", cantilever_benchmark_spec().model_dump())
    from drafty_api.jobs import job_dir

    directory = job_dir(job["id"])
    (directory / "results.json").write_text(
        json.dumps(
            {
                "solver": {"version": "CalculiX test"},
                "mesh": {"elements": 1},
                "mass_kg": 0.5652,
                "max_displacement_m": 0.001,
                "max_von_mises_pa": 1,
                "governing_von_mises_pa": 1,
                "safety_factor": 2,
                "validation_status": "solver_completed",
                "warnings": [],
                "stress_assessment": {"safety_factor_status": "exploratory"},
            }
        ),
        encoding="utf-8",
    )
    report = build_report(directory)
    assert report["mass_kg"] == 0.5652
    assert report["safety_factor_status"] == "exploratory"
    pdf = text_pdf("Drafty engineering report\nMass kg 0.5652")
    assert pdf.startswith(b"%PDF")
    assert b"0.5652" in pdf
