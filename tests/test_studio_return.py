"""Studio -> AI scenario return: the edited part replaces the proposal and refreshes context."""

import copy

import pytest

from drafty_engineering.plan import describe_studio_changes, inputs_from_studio_spec

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

RIB = {
    "label": "Rib",
    "face": "zmax",
    "shape": "polygon",
    "profile": [
        {"u": 0.0, "v": 0.0},
        {"u": 1.0, "v": 0.0},
        {"u": 1.0, "v": 1.0},
        {"u": 0.0, "v": 1.0},
    ],
    "width_m": 0.05,
    "height_m": 0.005,
    "depth_m": 0.01,
    "offset_u_m": 0.0,
    "offset_w_m": 0.0,
}


def _client(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from drafty_api.main import app
    from drafty_api.settings import settings

    monkeypatch.setattr(settings, "drafty_data_dir", str(tmp_path))
    monkeypatch.setattr("drafty_ai.scenario_agent.configured", lambda: False)
    monkeypatch.setattr("drafty_api.scenarios.configured", lambda: False)
    return TestClient(app)


def _approved_cantilever(client):
    scenario_id = client.post("/api/v1/scenarios").json()["id"]
    form_inputs = {key: value for key, value in CANTILEVER.items() if "face" not in key}
    turned = client.post(
        f"/api/v1/scenarios/{scenario_id}/turn",
        json={"message": "Design a cantilever beam.", "inputs": form_inputs},
    )
    assert turned.status_code == 200
    faces = client.post(
        f"/api/v1/scenarios/{scenario_id}/faces",
        json={"support_face": "xmin", "load_face": "xmax"},
    )
    assert faces.status_code == 200
    approved = client.post(f"/api/v1/scenarios/{scenario_id}/approve")
    assert approved.status_code == 200
    return scenario_id, approved.json()


def _spec(session: dict) -> dict:
    return {key: value for key, value in session["studio_spec"].items() if key != "approval"}


def test_inputs_from_studio_spec_maps_a_bracket_back_to_scenario_keys():
    spec = {
        "name": "bracket",
        "kind": "l_bracket",
        "material_id": "aluminum_6061_t6",
        "mesh_size_m": 0.004,
        "element_order": 2,
        "supports": [{"surface": "xmin", "constraint": "encastre"}],
        "loads": [
            {"surface": "zmax", "mode": "force", "magnitude": 200.0, "direction": {"x": 0, "y": 0, "z": -1}}
        ],
        "beam": None,
        "plate": None,
        "bracket": {"leg_x_m": 0.09, "leg_z_m": 0.07, "thickness_m": 0.008, "width_m": 0.04},
        "holes": None,
        "additions": [],
    }
    patch = inputs_from_studio_spec(spec)
    assert patch is not None
    assert patch["physical_system"] == "l_bracket"
    assert patch["leg_x_m"] == pytest.approx(0.09)
    assert patch["force_n"] == pytest.approx(200.0)
    assert inputs_from_studio_spec({"kind": "plate"}) is None


def test_describe_studio_changes_names_only_what_moved():
    spec = {
        "kind": "cantilever_beam",
        "beam": {"length_m": 0.3, "width_m": 0.02, "height_m": 0.012},
        "material_id": "steel_s235",
        "mesh_size_m": 0.0036,
        "element_order": 2,
        "supports": [{"surface": "xmin"}],
        "loads": [{"surface": "xmax", "mode": "force", "magnitude": 100.0, "direction": {"x": 0, "y": 0, "z": -1}}],
        "additions": [],
        "name": "ai-cantilever-beam",
    }
    assert describe_studio_changes(spec, copy.deepcopy(spec)) == []
    edited = copy.deepcopy(spec)
    edited["beam"]["length_m"] = 0.35
    assert describe_studio_changes(spec, edited) == ["length 300 mm → 350 mm"]


def test_returning_an_edited_part_updates_inputs_context_and_messages(tmp_path, monkeypatch):
    with _client(tmp_path, monkeypatch) as client:
        scenario_id, approved = _approved_cantilever(client)
        edited = _spec(approved)
        edited["beam"]["length_m"] = 0.35
        edited["loads"][0]["magnitude"] = 250.0
        returned = client.post(f"/api/v1/scenarios/{scenario_id}/studio-return", json={"spec": edited})
        assert returned.status_code == 200
        body = returned.json()
        assert body["studio_spec"]["beam"]["length_m"] == pytest.approx(0.35)
        assert body["studio_spec"]["studio_edited"] is True
        assert body["studio_approval"] == "confirmed"
        assert body["inputs"]["beam.length_m"] == pytest.approx(0.35)
        assert body["inputs"]["load_magnitude"] == pytest.approx(250.0)
        assert body["inputs"]["physical_system"] == "cantilever_beam"
        assert body["missing"] == []
        assert body["version"] == approved["version"] + 1
        # The next AI turn must not continue the old Meta conversation.
        assert body["previous_response_id"] is None
        assert body["context_reset"] is True
        assert body["messages"][-2]["text"] == "Returned from Studio with the edited part."
        assert "length 300 mm → 350 mm" in body["messages"][-1]["text"]
        assert "started no solver" in body["messages"][-1]["text"]
        quantities = {item["name"]: item["value_si"] for item in body["engineering"]["quantities"]}
        assert quantities["length"] == pytest.approx(0.35)

        # A later chat turn keeps the returned values instead of the old proposal.
        turned = client.post(
            f"/api/v1/scenarios/{scenario_id}/turn",
            json={"message": "Keep this part.", "inputs": {}},
        )
        assert turned.status_code == 200
        assert turned.json()["inputs"]["beam.length_m"] == pytest.approx(0.35)
        assert turned.json()["studio_spec"]["beam"]["length_m"] == pytest.approx(0.35)
    assert list(tmp_path.glob("jobs/**")) == []


def test_returning_an_unchanged_part_is_a_no_op(tmp_path, monkeypatch):
    with _client(tmp_path, monkeypatch) as client:
        scenario_id, approved = _approved_cantilever(client)
        returned = client.post(
            f"/api/v1/scenarios/{scenario_id}/studio-return", json={"spec": _spec(approved)}
        )
        assert returned.status_code == 200
        assert returned.json()["version"] == approved["version"]
        assert returned.json()["messages"] == approved["messages"]


def test_returning_a_sketch_addition_survives_the_next_chat_turn(tmp_path, monkeypatch):
    with _client(tmp_path, monkeypatch) as client:
        scenario_id, approved = _approved_cantilever(client)
        edited = _spec(approved)
        edited["additions"] = [RIB]
        returned = client.post(f"/api/v1/scenarios/{scenario_id}/studio-return", json={"spec": edited})
        assert returned.status_code == 200
        assert returned.json()["studio_spec"]["additions"][0]["label"] == "Rib"
        turned = client.post(
            f"/api/v1/scenarios/{scenario_id}/turn",
            json={"message": "Keep this part.", "inputs": {}},
        )
        assert turned.status_code == 200
        assert len(turned.json()["studio_spec"]["additions"]) == 1


def test_studio_return_rejects_invalid_or_missing_parts(tmp_path, monkeypatch):
    with _client(tmp_path, monkeypatch) as client:
        scenario_id, _approved = _approved_cantilever(client)
        invalid = client.post(
            f"/api/v1/scenarios/{scenario_id}/studio-return", json={"spec": {"kind": "plate"}}
        )
        assert invalid.status_code == 422
        fresh_id = client.post("/api/v1/scenarios").json()["id"]
        valid = _spec(_approved)
        missing = client.post(f"/api/v1/scenarios/{fresh_id}/studio-return", json={"spec": valid})
        assert missing.status_code == 422
