import io

import pytest
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


CLASSROOM = {
    "jurisdiction": "Colombia",
    "span_m": 6,
    "tributary_width_m": 2.5,
    "dead_n_per_m2": 3000,
    "depth_m": 0.2,
    "flange_width_m": 0.1,
    "flange_thickness_m": 0.01,
    "web_thickness_m": 0.006,
    "supports": "simply supported",
}


def test_confirmed_beam_elements_run_and_a_solid_model_stays_closed(tmp_path, monkeypatch):
    with _client(tmp_path, monkeypatch) as client:
        scenario_id = client.post("/api/v1/scenarios").json()["id"]
        blocked = client.post(
            f"/api/v1/scenarios/{scenario_id}/analyze",
            json={"method": "calculix", "inputs": CLASSROOM},
        )
        missing = client.post(
            f"/api/v1/scenarios/{scenario_id}/analyze",
            json={"method": "euler-bernoulli", "inputs": {**CLASSROOM, "span_m": None}},
        )
        fixed = client.post(
            f"/api/v1/scenarios/{scenario_id}/analyze",
            json={"method": "euler-bernoulli", "inputs": {**CLASSROOM, "supports": "fixed at one end"}},
        )
        invalid = client.post(
            f"/api/v1/scenarios/{scenario_id}/analyze",
            json={"method": "euler-bernoulli", "inputs": {**CLASSROOM, "depth_m": 0.01, "flange_thickness_m": 0.02}},
        )
        solved = client.post(
            f"/api/v1/scenarios/{scenario_id}/analyze",
            json={"method": "euler-bernoulli", "elements": 16, "inputs": CLASSROOM},
        )
        compared = client.post(
            f"/api/v1/scenarios/{scenario_id}/analyze",
            json={"method": "euler-bernoulli", "compare": True, "inputs": {**CLASSROOM, "span_m": 5}},
        )
        report = client.get(f"/api/v1/scenarios/{scenario_id}/report")
        stale = client.post(
            f"/api/v1/scenarios/{scenario_id}/turn",
            json={"message": "Change the span.", "inputs": {**CLASSROOM, "span_m": 7}},
        )
        stale_report = client.get(f"/api/v1/scenarios/{scenario_id}/report")
    assert blocked.status_code == 422
    assert "cantilever" in blocked.json()["detail"]
    assert missing.status_code == 422
    assert fixed.status_code == 422
    assert "cantilever" in fixed.json()["detail"]
    assert invalid.status_code == 422
    body = solved.json()
    assert body["analysis"]["passed"] is True
    assert body["analysis"]["method"] == "euler-bernoulli"
    deflection = body["analysis"]["midspan_deflection_m"]
    assert deflection == pytest.approx(body["analysis"]["analytical_midspan_deflection_m"], rel=0.01)
    assert body["analysis"]["material"]["source"].startswith("EN 10025")
    assert body["model_proposal"]["ready_for_3d_simulation"] is False
    assert body["model_proposal"]["ready_for_beam_elements"] is True
    assert body["inputs"]["span_m"] == 6
    assert compared.json()["comparison"]["span_m"] == 5
    assert compared.json()["analysis"]["span_m"] == 6
    assert compared.json()["inputs"]["span_m"] == 6
    assert report.status_code == 200
    assert report.json()["certification"] == "not claimed"
    assert report.json()["analysis"]["solver"]["name"] == "drafty-beam-element"
    assert stale.json()["analysis"]["stale"] is True
    assert stale_report.status_code == 404
    assert list(tmp_path.glob("jobs/**")) == []


def test_rejecting_a_suggestion_keeps_the_typed_span(tmp_path, monkeypatch):
    with _client(tmp_path, monkeypatch) as client:
        created = client.post("/api/v1/scenarios")
        scenario_id = created.json()["id"]
        reviewed = client.post(
            f"/api/v1/scenarios/{scenario_id}/turn",
            json={"message": "Review the span.", "inputs": {"span_m": 6}},
        )
        dismissed = client.post(f"/api/v1/scenarios/{scenario_id}/dismiss")
    assert reviewed.status_code == 200
    assert reviewed.json()["ai"] == "not called"
    body = dismissed.json()
    assert dismissed.status_code == 200
    assert body["inputs"]["span_m"] == 6
    assert body["model_questions"] == []
    assert "set aside" in body["messages"][-1]["text"]
    assert body["ai"] == "not called"


def test_segment_without_a_key_does_not_call_the_provider(tmp_path, monkeypatch):
    with _client(tmp_path, monkeypatch) as client:
        scenario_id = client.post("/api/v1/scenarios").json()["id"]
        uploaded = client.post(
            f"/api/v1/scenarios/{scenario_id}/evidence",
            files={"file": ("part.png", io.BytesIO(PNG), "image/png")},
            data={"role": "photo", "note": ""},
        )
        evidence_id = uploaded.json()["evidence"][0]["id"]
        segmented = client.post(
            f"/api/v1/scenarios/{scenario_id}/segment",
            json={"evidence_id": evidence_id, "prompt": "bracket"},
        )
        approved = client.post(f"/api/v1/scenarios/{scenario_id}/approve")
    assert segmented.status_code == 503
    assert "MODEL_API_KEY" in segmented.json()["detail"]
    assert approved.status_code == 422


def test_rejecting_a_bracket_proposal_does_not_start_calculix(tmp_path, monkeypatch):
    message = (
        "Design an aluminum bracket. Force 200 N. Legs 80 mm by 80 mm. "
        "Thickness 8 mm. Bracket width 40 mm. Displacement limit 1 mm."
    )
    with _client(tmp_path, monkeypatch) as client:
        scenario_id = client.post("/api/v1/scenarios").json()["id"]
        turned = client.post(
            f"/api/v1/scenarios/{scenario_id}/turn",
            json={"message": message, "inputs": {}},
        )
        unconfirmed = client.post(f"/api/v1/scenarios/{scenario_id}/approve")
        faces = client.post(
            f"/api/v1/scenarios/{scenario_id}/faces",
            json={"support_face": "xmin", "load_face": "zmax"},
        )
        rejected = client.post(f"/api/v1/scenarios/{scenario_id}/reject")
        blocked = client.post(f"/api/v1/scenarios/{scenario_id}/approve")
    assert turned.status_code == 200
    assert turned.json()["studio_spec"] is None
    assert turned.json()["ai"] == "not called"
    assert unconfirmed.status_code == 422
    assert faces.status_code == 200
    assert faces.json()["studio_spec"]["supports"][0]["surface"] == "xmin"
    assert faces.json()["studio_spec"]["loads"][0]["surface"] == "zmax"
    assert faces.json()["tool_trace"][0]["status"] == "proposed"
    assert rejected.status_code == 200
    assert rejected.json()["studio_approval"] == "rejected"
    assert blocked.status_code == 409
    assert list(tmp_path.glob("jobs/**")) == []
