import pytest
from fastapi import HTTPException

from drafty_api.jobs import create_job
from drafty_api.remote import complete_remote_job
from drafty_api.settings import settings

JOB = "11111111-1111-4111-8111-111111111111"


def test_production_refuses_local_calculix(monkeypatch):
    monkeypatch.setattr(settings, "drafty_env", "production")
    with pytest.raises(HTTPException) as caught:
        create_job("owner", "simulation", {"kind": "beam"}, compute="local")
    assert caught.value.status_code == 409
    assert "Local CalculiX was not started" in caught.value.detail


def test_callback_rejects_a_bad_token(monkeypatch):
    monkeypatch.setattr("drafty_api.remote._dispatch", lambda job_id: {"callback_token": "expected"})
    with pytest.raises(HTTPException) as caught:
        complete_remote_job(JOB, "nope", {"status": "completed", "manifest": []})
    assert caught.value.status_code == 401


def test_completed_callback_is_idempotent(monkeypatch):
    monkeypatch.setattr("drafty_api.remote._dispatch", lambda job_id: {"callback_token": "tok"})
    monkeypatch.setattr(
        "drafty_api.remote._select",
        lambda table, params: [{"id": JOB, "status": "completed"}],
    )
    result = complete_remote_job(JOB, "tok", {"status": "completed", "manifest": []})
    assert result["status"] == "completed"


def test_checksum_mismatch_does_not_complete(monkeypatch):
    updates: list[dict] = []
    monkeypatch.setattr("drafty_api.remote._dispatch", lambda job_id: {"callback_token": "tok"})
    monkeypatch.setattr(
        "drafty_api.remote._select",
        lambda table, params: [{"id": JOB, "status": "submitted"}],
    )
    def remember(job_id, fields, dispatch=None):
        updates.append(fields)
        return fields

    monkeypatch.setattr("drafty_api.remote._update_job", remember)
    monkeypatch.setattr("drafty_api.remote._hash_object", lambda path: ("abc", 4))
    with pytest.raises(HTTPException) as caught:
        complete_remote_job(
            JOB,
            "tok",
            {"status": "completed", "manifest": [{"name": "results.json", "sha256": "def"}]},
        )
    assert caught.value.status_code == 409
    assert updates[-1]["status"] == "failed"
