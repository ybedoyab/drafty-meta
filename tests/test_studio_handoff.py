"""AI -> Studio handoff for the Studio sample parts (cantilever, plate, perforated plate)."""

import pytest

from drafty_ai.scenario_agent import advance_scenario, blank_inputs
from drafty_engineering.plan import classify_request, proposed_studio_spec

CANTILEVER = {
    "beam.length_m": 0.3,
    "beam.width_m": 0.02,
    "beam.height_m": 0.012,
    "material_id": "steel_s235",
    "load_mode": "force",
    "load_magnitude": 100.0,
    "support_face": "xmin",
    "load_face": "xmax",
}
PLATE = {
    "plate.length_m": 0.16,
    "plate.width_m": 0.06,
    "plate.thickness_m": 0.008,
    "material_id": "aluminum_6061_t6",
    "load_mode": "pressure",
    "load_magnitude": 10_000.0,
    "support_face": "xmin",
    "load_face": "zmax",
}
PERFORATED = {
    **PLATE,
    "holes.radius_m": 0.004,
    "holes.count_x": 3,
    "holes.count_y": 1,
    "holes.margin_m": 0.02,
}


@pytest.mark.parametrize(
    ("message", "system"),
    [
        ("Design a cantilever beam, 300 mm long.", "cantilever_beam"),
        ("Design a rectangular plate.", "plate"),
        ("Design a perforated plate with holes.", "perforated_plate"),
        ("Design a plate with holes.", "perforated_plate"),
    ],
)
def test_studio_sample_parts_classify_in_chat(message, system):
    found = classify_request(message)
    assert found.system == system
    assert found.domain == "mechanical"


@pytest.mark.parametrize(
    ("inputs", "kind", "geometry_key"),
    [
        (CANTILEVER, "cantilever_beam", "beam"),
        (PLATE, "plate", "plate"),
        (PERFORATED, "perforated_plate", "plate"),
    ],
)
def test_proposed_studio_spec_builds_each_kind(inputs, kind, geometry_key):
    spec = proposed_studio_spec({"physical_system": kind, **inputs})
    assert spec is not None
    assert spec["kind"] == kind
    assert spec[geometry_key] is not None
    assert spec["supports"][0]["surface"] == inputs["support_face"]
    assert spec["loads"][0]["surface"] == inputs["load_face"]
    assert spec["loads"][0]["mode"] == inputs["load_mode"]
    if kind == "perforated_plate":
        assert spec["holes"]["count_x"] == 3


def test_proposed_studio_spec_stays_none_until_faces_and_load_exist():
    incomplete = {key: value for key, value in PLATE.items() if key not in {"support_face", "load_face"}}
    assert proposed_studio_spec({"physical_system": "plate", **incomplete}) is None
    no_load = {**PLATE, "load_magnitude": None}
    assert proposed_studio_spec({"physical_system": "plate", **no_load}) is None


def test_advance_scenario_proposes_a_plate_for_studio():
    inputs = blank_inputs()
    inputs.update(PLATE)
    result = advance_scenario(
        {"inputs": inputs, "messages": [], "evidence": []},
        "Design a rectangular plate.",
    )
    assert result["engineering"]["physical_system"] == "plate"
    assert result["studio_spec"]["kind"] == "plate"
    assert result["studio_spec"]["approval"] == "pending"
    assert result["missing"] == []


def _client(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from drafty_api.main import app
    from drafty_api.settings import settings

    monkeypatch.setattr(settings, "drafty_data_dir", str(tmp_path))
    monkeypatch.setattr("drafty_ai.scenario_agent.configured", lambda: False)
    monkeypatch.setattr("drafty_api.scenarios.configured", lambda: False)
    return TestClient(app)


def test_api_hands_a_cantilever_to_studio_after_faces_and_approval(tmp_path, monkeypatch):
    form_inputs = {key: value for key, value in CANTILEVER.items() if "face" not in key}
    with _client(tmp_path, monkeypatch) as client:
        scenario_id = client.post("/api/v1/scenarios").json()["id"]
        turned = client.post(
            f"/api/v1/scenarios/{scenario_id}/turn",
            json={"message": "Design a cantilever beam.", "inputs": form_inputs},
        )
        assert turned.status_code == 200
        assert turned.json()["studio_spec"] is None
        faces = client.post(
            f"/api/v1/scenarios/{scenario_id}/faces",
            json={"support_face": "xmin", "load_face": "xmax"},
        )
        assert faces.status_code == 200
        assert faces.json()["studio_spec"]["kind"] == "cantilever_beam"
        assert faces.json()["studio_spec"]["beam"]["length_m"] == pytest.approx(0.3)
        approved = client.post(f"/api/v1/scenarios/{scenario_id}/approve")
        assert approved.status_code == 200
        assert approved.json()["studio_approval"] == "confirmed"
        assert approved.json()["studio_spec"]["kind"] == "cantilever_beam"
    assert list(tmp_path.glob("jobs/**")) == []
