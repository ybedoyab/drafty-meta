import io

from fastapi.testclient import TestClient

from drafty_api.main import app
from drafty_api.settings import settings
from drafty_engineering.spec import cantilever_benchmark_spec

PNG = bytes.fromhex(
    "89504e470d0a1a0a"
    "0000000d4948445200000001000000010802000000907753de"
    "0000000c4944415408d763f8cfc0000000030001c7e4e3d3"
    "0000000049454e44ae426082"
)


def _client(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "drafty_data_dir", str(tmp_path))
    return TestClient(app)


def test_invalid_material_is_rejected(tmp_path, monkeypatch):
    payload = cantilever_benchmark_spec().model_dump()
    payload["material_id"] = "unobtanium"
    with _client(tmp_path, monkeypatch) as client:
        response = client.post("/api/v1/designs/validate", json=payload)
    assert response.status_code == 422


def test_non_uuid_job_is_not_found(tmp_path, monkeypatch):
    with _client(tmp_path, monkeypatch) as client:
        response = client.get("/api/v1/jobs/not-a-uuid")
    assert response.status_code == 404


def test_reference_upload_checks_bytes_and_owner(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "drafty_auth_mode", "disabled")
    with _client(tmp_path, monkeypatch) as client:
        rejected = client.post(
            "/api/v1/uploads/reference",
            files={"file": ("notes.txt", io.BytesIO(b"not an image"), "image/png")},
        )
        assert rejected.status_code == 422
        accepted = client.post(
            "/api/v1/uploads/reference",
            files={"file": ("part.png", io.BytesIO(PNG), "text/plain")},
        )
        assert accepted.status_code == 200
        image_id = accepted.json()["id"]
        missing = client.post("/api/v1/ai/interpret", json={"message": "beam", "reference_image_id": "../secrets"})
        assert missing.status_code == 404
        owned = (tmp_path / "uploads" / f"{image_id}.json").read_text(encoding="utf-8")
        assert '"owner_id": "local"' in owned


def test_interpret_requires_an_owner_before_a_model_call(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "drafty_auth_mode", "supabase")
    with _client(tmp_path, monkeypatch) as client:
        response = client.post("/api/v1/ai/interpret", json={"message": "a 300 mm cantilever"})
        segment = client.post("/api/v1/ai/segment")
    assert response.status_code == 401
    assert segment.status_code == 401


def test_classroom_scenario_rejects_a_missing_width_and_calculates_when_known(tmp_path, monkeypatch):
    with _client(tmp_path, monkeypatch) as client:
        missing = client.post("/api/v1/scenarios/classroom", json={"dead_n_per_m2": 3000})
        calculated = client.post(
            "/api/v1/scenarios/classroom",
            json={
                "dead_n_per_m2": 3000,
                "tributary_width_m": 2.5,
                "beam_self_weight_n_per_m": 400,
                "span_m": 6,
                "depth_m": 0.2,
                "flange_width_m": 0.1,
                "flange_thickness_m": 0.01,
                "web_thickness_m": 0.006,
            },
        )
    assert missing.status_code == 422
    assert calculated.status_code == 200
    body = calculated.json()
    assert body["ai"] == "not called"
    assert body["calculation"]["ready_for_3d_simulation"] is False
    assert body["calculation"]["q_line_n_per_m"] == 12900
    assert body["beam"]["max_moment_n_m"] > 0
    assert body["section"]["area_m2"] > 0
