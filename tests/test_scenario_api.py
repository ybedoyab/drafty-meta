import io

from fastapi.testclient import TestClient

from drafty_api.main import app
from drafty_api.settings import settings

PNG = bytes.fromhex(
    "89504e470d0a1a0a"
    "0000000d4948445200000001000000010802000000907753de"
    "0000000c4944415408d763f8cfc0000000030001c7e4e3d3"
    "0000000049454e44ae426082"
)


def _client(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "drafty_data_dir", str(tmp_path))
    monkeypatch.setattr("drafty_ai.scenario_agent.configured", lambda: False)
    monkeypatch.setattr("drafty_api.scenarios.configured", lambda: False)
    return TestClient(app)


def test_classroom_turn_calculates_on_the_server_and_refuses_simulation(tmp_path, monkeypatch):
    with _client(tmp_path, monkeypatch) as client:
        created = client.post("/api/v1/scenarios")
        assert created.status_code == 200
        scenario_id = created.json()["id"]
        asked = client.post(
            f"/api/v1/scenarios/{scenario_id}/turn",
            json={"message": "A classroom floor for 30 students.", "inputs": {}},
        )
        solved = client.post(
            f"/api/v1/scenarios/{scenario_id}/turn",
            json={
                "message": "Review the current inputs.",
                "inputs": {
                    "jurisdiction": "Colombia",
                    "span_m": 6,
                    "tributary_width_m": 2.5,
                    "dead_n_per_m2": 3000,
                    "supports": "simply supported",
                },
            },
        )
    assert asked.status_code == 200
    assert asked.json()["calculation"] is None
    assert asked.json()["ai"] == "not called"
    body = solved.json()
    assert body["calculation"]["q_line_n_per_m"] == 12500
    assert body["model_proposal"]["ready_for_3d_simulation"] is False
    assert body["sources"][0]["origin"] == "checked template"


def test_scenario_resume_upload_and_removal(tmp_path, monkeypatch):
    with _client(tmp_path, monkeypatch) as client:
        scenario_id = client.post("/api/v1/scenarios").json()["id"]
        uploaded = client.post(
            f"/api/v1/scenarios/{scenario_id}/evidence",
            files={"file": ("plan.png", io.BytesIO(PNG), "image/png")},
            data={"role": "drawing", "note": "context only"},
        )
        rejected = client.post(
            f"/api/v1/scenarios/{scenario_id}/evidence",
            files={"file": ("notes.txt", io.BytesIO(b"not an image"), "text/plain")},
        )
        evidence_id = uploaded.json()["evidence"][0]["id"]
        fetched = client.get(f"/api/v1/scenarios/{scenario_id}/evidence/{evidence_id}")
        removed = client.delete(f"/api/v1/scenarios/{scenario_id}/evidence/{evidence_id}")
        missing = client.get(f"/api/v1/scenarios/{scenario_id}/evidence/{evidence_id}")
        traversal = client.get(f"/api/v1/scenarios/{scenario_id}/evidence/not-a-uuid")
        resumed = client.get(f"/api/v1/scenarios/{scenario_id}")
    assert uploaded.status_code == 200
    assert uploaded.json()["evidence"][0]["sha256"]
    assert rejected.status_code == 422
    assert fetched.status_code == 200
    assert fetched.content == PNG
    assert removed.json()["evidence"] == []
    assert missing.status_code == 404
    assert traversal.status_code == 404
    assert resumed.json()["evidence"] == []
