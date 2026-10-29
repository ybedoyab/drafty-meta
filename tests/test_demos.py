import io
import wave

import pytest
from fastapi.testclient import TestClient

from drafty_api.main import app
from drafty_api.settings import settings


def _client(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "drafty_data_dir", str(tmp_path))
    monkeypatch.setattr(settings, "drafty_auth_mode", "disabled")
    return TestClient(app)


def test_classroom_demo_fills_every_preset_field(tmp_path, monkeypatch):
    with _client(tmp_path, monkeypatch) as client:
        created = client.post("/api/v1/scenarios")
        loaded = client.post("/api/v1/scenarios/demo", json={"kind": "classroom", "scenario_id": created.json()["id"]})
    assert loaded.status_code == 200
    body = loaded.json()
    inputs = body["inputs"]
    assert body["id"] == created.json()["id"]
    assert body["demo"]["version"] == "classroom-v1"
    assert body["ai"] == "not called"
    assert inputs["domain"] == "structural"
    assert inputs["jurisdiction"] == "Colombia"
    assert inputs["student_count"] == 30
    assert inputs["supports"] == "simply supported"
    assert inputs["span_m"] == 6.0
    assert inputs["tributary_width_m"] == 2.5
    assert inputs["dead_n_per_m2"] == 3000.0
    assert inputs["live_n_per_m2"] == 2000.0
    assert inputs["beam_self_weight_n_per_m"] == 0.0
    assert inputs["depth_m"] == 0.2
    assert inputs["flange_width_m"] == 0.1
    assert inputs["flange_thickness_m"] == 0.01
    assert inputs["web_thickness_m"] == 0.006
    assert inputs["material_id"] == "steel_s235"
    assert body["calculation"]["q_line_n_per_m"] == 12500.0
    assert body["model_proposal"]["ready_for_beam_elements"] is True
    assert body["model_proposal"]["ready_for_3d_simulation"] is False
    assert any("NSR-10" in item["statement"] for item in body["assumptions"])
    assert any("not an approved design" in item["statement"] for item in body["assumptions"])


def test_classroom_demo_analysis_uses_the_beam_solver(tmp_path, monkeypatch):
    with _client(tmp_path, monkeypatch) as client:
        created = client.post("/api/v1/scenarios").json()
        loaded = client.post("/api/v1/scenarios/demo", json={"kind": "classroom", "scenario_id": created["id"]}).json()
        analyzed = client.post(
            f"/api/v1/scenarios/{loaded['id']}/analyze",
            json={"method": "euler-bernoulli", "elements": 16, "inputs": loaded["inputs"]},
        )
    assert analyzed.status_code == 200
    analysis = analyzed.json()["analysis"]
    assert analysis["solver"]["name"] == "drafty-beam-element"
    assert analysis["left_reaction_n"] == pytest.approx(37500.0, rel=1e-6)
    assert analysis["max_moment_n_m"] == pytest.approx(56250.0, rel=1e-6)


def test_demo_does_not_replace_a_user_scenario(tmp_path, monkeypatch):
    with _client(tmp_path, monkeypatch) as client:
        created = client.post("/api/v1/scenarios").json()
        turned = client.post(
            f"/api/v1/scenarios/{created['id']}/turn",
            json={"message": "Keep this note.", "inputs": {}},
        )
        assert turned.status_code == 200
        loaded = client.post("/api/v1/scenarios/demo", json={"kind": "classroom", "scenario_id": created["id"]})
        original = client.get(f"/api/v1/scenarios/{created['id']}")
    assert loaded.status_code == 200
    assert loaded.json()["id"] != created["id"]
    assert any(item["text"] == "Keep this note." for item in original.json()["messages"])


def test_bracket_demo_waits_for_face_confirmation(tmp_path, monkeypatch):
    with _client(tmp_path, monkeypatch) as client:
        created = client.post("/api/v1/scenarios").json()
        loaded = client.post("/api/v1/scenarios/demo", json={"kind": "bracket", "scenario_id": created["id"]})
    body = loaded.json()
    assert body["demo"]["version"] == "bracket-v1"
    assert body["inputs"]["material_id"] == "aluminum_6061_t6"
    assert body["inputs"]["leg_x_m"] == 0.08
    assert body["inputs"]["leg_z_m"] == 0.08
    assert body["inputs"]["bracket_width_m"] == 0.04
    assert body["inputs"]["bracket_thickness_m"] == 0.008
    assert body["inputs"]["force_n"] == 200.0
    assert body["inputs"]["displacement_limit_m"] == 0.001
    assert body["inputs"]["support_face"] == ""
    assert body["inputs"]["load_face"] == ""
    assert body["suggested_faces"] == {"support_face": "xmin", "load_face": "zmax"}
    assert body["studio_spec"] is None
    assert "fixed face and load face" in body["missing"]


def _wav() -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(24000)
        handle.writeframes(b"\x00\x00" * 2400)
    return buffer.getvalue()


def test_transcription_rejects_a_file_that_is_not_wav(tmp_path, monkeypatch):
    with _client(tmp_path, monkeypatch) as client:
        response = client.post(
            "/api/v1/speech/transcribe",
            files={"audio": ("notes.txt", b"not audio", "text/plain")},
        )
    assert response.status_code == 422


def test_transcription_posts_the_documented_contract(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "model_api_key", "test-key")
    captured: dict = {}

    class FakeResponse:
        status_code = 200

        def json(self):
            return {"transcript": "The span is six meters."}

    class FakeClient:
        def __init__(self, timeout):
            captured["timeout"] = timeout

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def post(self, url, params, headers, files):
            captured["url"] = url
            captured["session"] = params["sessionId"]
            captured["authorization"] = headers["Authorization"]
            captured["request"] = files["request"][1]
            captured["audio_type"] = files["audio"][2]
            return FakeResponse()

    monkeypatch.setattr("drafty_api.speech.httpx.Client", FakeClient)
    with _client(tmp_path, monkeypatch) as client:
        response = client.post(
            "/api/v1/speech/transcribe",
            files={"audio": ("speech.wav", _wav(), "audio/wav")},
        )
    assert response.status_code == 200
    assert response.json()["transcript"] == "The span is six meters."
    assert captured["url"].endswith("/asr/transcribe")
    assert captured["authorization"] == "Bearer test-key"
    assert "English" in captured["request"] and "Spanish" in captured["request"]
    assert "muse-voice-transcribe-1.0" in captured["request"]
    assert "PUSH_TO_TALK" in captured["request"]
    assert captured["audio_type"] == "audio/wav"
    assert "test-key" not in response.text
