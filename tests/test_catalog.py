import json
from typing import get_args

import pytest

from drafty_ai.scenario_agent import INSTRUCTIONS, advance_scenario, blank_inputs
from drafty_engineering.catalog import (
    CAPABILITIES_PATH,
    PARTS,
    catalog_view,
    scenario_parts,
    studio_kinds,
    supported_parts_sentence,
    unsupported_sentence,
)
from drafty_engineering.plan import classify_request, route_tool
from drafty_engineering.spec import PartKind

# A knight is not in the registry. The pawn is (see test_revolved.py).
KNIGHT_REQUEST = "I want to design a basic chess knight to render in 3D."
KNIGHT_ANSWER = "Staunton knight, 60 mm tall, 30 mm base, STEP, decorative PLA."
IBEAM_FIELDS = {"span_m", "tributary_width_m", "dead_n_per_m2", "live_n_per_m2", "flange_width_m", "jurisdiction"}


def _reply(message: str, questions: list[str] | None = None, tool: str = "inspect_scenario", claims=None):
    def responder(**_kwargs):
        return {
            "id": "resp_pawn",
            "model": "muse-spark-1.3",
            "text": json.dumps(
                {
                    "message": message,
                    "questions": questions or [],
                    "observations": [],
                    "domain": "mechanical",
                    "physical_system": "unknown",
                    "tool": tool,
                    "claims": claims or [],
                }
            ),
            "citations": [],
            "usage": {"input_tokens": 3, "output_tokens": 4},
        }

    return responder


def test_registry_studio_kinds_match_the_design_schema():
    assert studio_kinds() == set(get_args(PartKind))


def test_every_registry_input_has_a_label_and_a_known_kind():
    for part in PARTS.values():
        assert part.inputs, part.id
        assert part.analysis and part.exports
        for item in part.inputs:
            assert item.label
            if item.kind == "number":
                assert item.unit, f"{part.id}.{item.name} needs a unit"
            if item.kind in {"choice", "face"}:
                assert item.choices


def test_instructions_list_the_registry_and_forbid_promises():
    sentence = supported_parts_sentence()
    assert sentence in INSTRUCTIONS
    for part in PARTS.values():
        assert part.name in sentence
    assert "If the request is not one of these parts, say Drafty cannot model it yet" in INSTRUCTIONS
    assert "never say you will generate geometry or a file" in INSTRUCTIONS
    for part in scenario_parts():
        assert part.id in INSTRUCTIONS


@pytest.mark.parametrize("noun", ["coffee mug", "perforated plate", ""])
def test_an_unsupported_reply_points_to_the_capabilities_page(noun):
    sentence = unsupported_sentence(noun)
    assert sentence.endswith(f"The Capabilities page ({CAPABILITIES_PATH}) lists what Drafty can and cannot do.")
    assert catalog_view("unsupported", noun)["message"] == sentence


def test_the_public_registry_lists_methods_and_limits_for_the_capabilities_page():
    for part in PARTS.values():
        shown = part.public()
        assert shown["methods"] == list(part.methods)
        assert shown["limits"] == list(part.limits)
        assert shown["methods"], f"{part.id} needs at least one method"


def test_reply_schema_enums_come_from_the_registry():
    from drafty_ai.responses import REPLY_FORMAT

    systems = REPLY_FORMAT["schema"]["properties"]["physical_system"]["enum"]
    assert set(systems) == {part.id for part in scenario_parts()} | {"unsupported", "ambiguous", "unknown"}
    domains = REPLY_FORMAT["schema"]["properties"]["domain"]["enum"]
    assert "ambiguous" in domains


@pytest.mark.parametrize(
    ("message", "noun"),
    [
        (KNIGHT_REQUEST, "chess knight"),
        ("Make me a 3D model of a coffee mug for printing.", "coffee mug"),
        ("Necesito diseñar un engranaje recto para una bicicleta.", "engranaje recto"),
        ("Can you build a drone frame with four arms?", "drone frame"),
    ],
)
def test_a_named_part_outside_the_registry_is_unsupported(message, noun):
    found = classify_request(message)
    assert found.domain == "unsupported"
    assert found.system == "unsupported"
    assert found.requested == noun


@pytest.mark.parametrize(
    "message",
    ["Review the sketches.", "What did you find?", "Design a part.", "Hello", "Review the current inputs."],
)
def test_a_vague_message_stays_unknown(message):
    assert classify_request(message) == ("unknown", "unknown", "")


def test_registry_parts_keep_their_classification():
    assert classify_request("aula con estudiantes")[:2] == ("structural", "simply_supported_ibeam")
    assert classify_request("aluminum bracket, minimum mass")[:2] == ("mechanical", "l_bracket")
    assert classify_request("aluminum bracket for a classroom shelf")[:2] == ("mechanical", "l_bracket")


def test_a_follow_up_keeps_the_unsupported_request_and_a_new_part_replaces_it():
    first = classify_request(KNIGHT_REQUEST)
    follow = classify_request(KNIGHT_ANSWER, first.domain, first.system, first.requested)
    assert follow == ("unsupported", "unsupported", "chess knight")
    switched = classify_request("Ok, then an aluminum bracket.", follow.domain, follow.system, follow.requested)
    assert switched == ("mechanical", "l_bracket", "")


def test_an_active_part_is_not_replaced_by_a_weak_request():
    found = classify_request("I need the span checked.", "structural", "simply_supported_ibeam")
    assert found[:2] == ("structural", "simply_supported_ibeam")


def test_unsupported_requests_only_route_to_inspection():
    common = dict(domain="unsupported", system="unsupported", missing=[], has_analysis=False, has_spec=False)
    assert route_tool(None, **common) == ("inspect_scenario", "ok")
    assert route_tool("create_supported_cad", **common) == ("create_supported_cad", "rejected")
    assert route_tool("propose_engineering_model", **common) == ("propose_engineering_model", "rejected")


def test_the_knight_conversation_is_honest_about_an_unsupported_part():
    asked = advance_scenario(
        {"inputs": blank_inputs(), "messages": [], "evidence": []},
        KNIGHT_REQUEST,
        responder=_reply(
            "I can help. What style, height, base diameter, and CAD format do you want?",
            ["What style?", "What height?", "What base diameter?", "Which CAD format?"],
        ),
    )
    answered = advance_scenario(
        asked,
        KNIGHT_ANSWER,
        responder=_reply(
            "Confirmed. I will generate the rotationally symmetric knight STEP model at 60 mm tall with a 30 mm base. "
            "The STEP file will be ready shortly.",
            ["Do you want a hollow base?"],
            tool="create_supported_cad",
            claims=[{"name": "export", "statement": "STEP export of the 60 mm knight", "source": "model"}],
        ),
    )
    for result in (asked, answered):
        text = result["messages"][-1]["text"]
        assert "Drafty can't model a chess knight yet." in text
        assert "No geometry, file, or calculation was created." in text
        assert f"({CAPABILITIES_PATH})" in text
        assert "Describe the structure or the part" not in text
        assert result["studio_spec"] is None
        assert result["model_questions"] == []
        assert result["engineering"]["domain"] == "unsupported"
        assert result["engineering"]["requested_part"] == "chess knight"
        assert result["engineering"]["validation_status"] == "blocked"
        assert result["phase"] == "unsupported"
        assert result["workflow"] == "understand"
        assert result["calculation"] is None and result["beam"] is None
        assert not IBEAM_FIELDS & set(result["missing"])
        catalog = result["part_catalog"]
        assert catalog["status"] == "unsupported"
        assert catalog["requested_part"] == "chess knight"
        assert catalog["form_part"] is None
        assert {part["id"] for part in catalog["parts"]} == set(PARTS)
    text = answered["messages"][-1]["text"]
    assert "I will generate" not in text
    assert "will be ready" not in text
    assert not text.startswith("Confirmed")
    assert "not a stored engineering result" not in text
    promises = [item for item in answered["rejected_claims"] if item["reason"] == "promise for an unsupported part"]
    assert len(promises) == 2
    assert answered["tool_trace"][0]["tool"] == "create_supported_cad"
    assert answered["tool_trace"][0]["status"] == "rejected"
    assert answered["inputs"]["span_m"] is None


def test_an_honest_unsupported_reply_is_kept():
    result = advance_scenario(
        {"inputs": blank_inputs(), "messages": [], "evidence": []},
        KNIGHT_REQUEST,
        responder=_reply("Drafty cannot model a chess knight yet. It can model a classroom I-beam or an L-bracket."),
    )
    text = result["messages"][-1]["text"]
    assert text.startswith("Drafty cannot model a chess knight yet.")
    assert not result["rejected_claims"]


def test_the_number_note_names_the_number_and_skips_the_users_numbers():
    inputs = blank_inputs()
    inputs.update(domain="structural", physical_system="simply_supported_ibeam")
    result = advance_scenario(
        {
            "inputs": inputs,
            "messages": [{"role": "user", "text": "The beam is 4.5 m from wall to wall."}],
            "evidence": [],
        },
        "The span is 6 m.",
        responder=_reply("With a 6 m span and 4.5 m walls the stress is about 140 MPa."),
    )
    text = result["messages"][-1]["text"]
    assert "The number 140 in that reply is not a stored engineering result." in text
    flagged = [item for item in result["rejected_claims"] if item["name"] == "message"]
    assert flagged[0]["numbers"] == ["140"]


def test_a_hidden_claim_number_is_named_in_the_note():
    result = advance_scenario(
        {"inputs": blank_inputs(), "messages": [], "evidence": []},
        "Design an aluminum bracket with minimum mass.",
        responder=_reply(
            "Run the solve.",
            tool="evaluate_beam",
            claims=[{"name": "stress", "statement": "The stress is 10 MPa.", "source": "none"}],
        ),
    )
    text = result["messages"][-1]["text"]
    assert "A model claim about stress used 10, which is not a stored result." in text


def test_a_fresh_scenario_shows_the_default_form_and_a_bracket_shows_its_own():
    fresh = catalog_view("", "")
    assert fresh["status"] == "unclassified"
    assert fresh["form_part"]["id"] == "simply_supported_ibeam"
    bracket = advance_scenario(
        {"inputs": blank_inputs(), "messages": [], "evidence": []},
        "Design an aluminum bracket. Force 200 N.",
    )
    form = bracket["part_catalog"]["form_part"]
    assert form["id"] == "l_bracket"
    names = {item["name"] for item in form["inputs"]}
    assert {"leg_x_m", "force_n", "material_id"} <= names
    assert not IBEAM_FIELDS & names


def test_studio_only_parts_point_to_studio():
    result = advance_scenario(
        {"inputs": blank_inputs(), "messages": [], "evidence": []},
        "Design a perforated plate with six holes.",
    )
    text = result["messages"][-1]["text"]
    assert "Drafty builds a perforated plate in Studio, not in this chat." in text
    assert result["studio_spec"] is None


def _client(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from drafty_api.main import app
    from drafty_api.settings import settings

    monkeypatch.setattr(settings, "drafty_data_dir", str(tmp_path))
    monkeypatch.setattr("drafty_ai.scenario_agent.configured", lambda: False)
    monkeypatch.setattr("drafty_api.scenarios.configured", lambda: False)
    return TestClient(app)


def test_the_api_exposes_the_registry_and_the_active_form(tmp_path, monkeypatch):
    with _client(tmp_path, monkeypatch) as client:
        parts = client.get("/api/v1/parts").json()["parts"]
        created = client.post("/api/v1/scenarios").json()
        turn = client.post(f"/api/v1/scenarios/{created['id']}/turn", json={"message": KNIGHT_REQUEST, "inputs": {}})
        resumed = client.get(f"/api/v1/scenarios/{created['id']}").json()
    assert {item["id"] for item in parts} == set(PARTS)
    assert created["part_catalog"]["form_part"]["id"] == "simply_supported_ibeam"
    body = turn.json()
    assert body["part_catalog"]["status"] == "unsupported"
    assert body["part_catalog"]["form_part"] is None
    assert "Drafty can't model a chess knight yet." in body["messages"][-1]["text"]
    assert resumed["part_catalog"]["requested_part"] == "chess knight"


def test_turn_inputs_are_checked_against_the_registry(tmp_path, monkeypatch):
    with _client(tmp_path, monkeypatch) as client:
        scenario_id = client.post("/api/v1/scenarios").json()["id"]
        bad = client.post(
            f"/api/v1/scenarios/{scenario_id}/turn", json={"message": "classroom", "inputs": {"span_m": "six"}}
        )
        material = client.post(
            f"/api/v1/scenarios/{scenario_id}/turn",
            json={"message": "bracket", "inputs": {"material_id": "unobtainium"}},
        )
        kept = client.post(
            f"/api/v1/scenarios/{scenario_id}/turn",
            json={
                "message": "Design an aluminum bracket.",
                "inputs": {"leg_x_m": 0.08, "support_face": "xmin", "physical_system": "unsupported", "rogue": 1},
            },
        )
    assert bad.status_code == 422
    assert material.status_code == 422
    inputs = kept.json()["inputs"]
    assert inputs["leg_x_m"] == 0.08
    assert inputs["support_face"] == ""
    assert inputs["physical_system"] == "l_bracket"
    assert "rogue" not in inputs
