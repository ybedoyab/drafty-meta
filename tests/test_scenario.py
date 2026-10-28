import pytest

from drafty_ai.client import MetaNotConfigured
from drafty_ai.responses import responses_with_search
from drafty_engineering.scenario import classroom_line_load, i_section_properties, simply_supported_udl


def test_classroom_line_load_uses_the_published_live_load_once():
    result = classroom_line_load(dead_n_per_m2=3000, tributary_width_m=2.5, beam_self_weight_n_per_m=400)
    assert result["live_n_per_m2"] == 2000
    assert result["q_line_n_per_m"] == pytest.approx((3000 + 2000) * 2.5 + 400)
    assert result["ready_for_3d_simulation"] is False
    assert result["citation"]["status"] == "verified reference"
    assert result["trace"]["inputs"]["q_live"]["status"] == "assumed"


def test_missing_tributary_width_is_rejected():
    with pytest.raises(ValueError, match="Tributary width"):
        classroom_line_load(3000, None)


def test_i_section_and_simple_span_match_the_closed_form():
    section = i_section_properties(0.2, 0.1, 0.01, 0.006)
    web = 0.2 - 0.02
    area = 2 * 0.1 * 0.01 + web * 0.006
    inertia = (0.1 * 0.2**3 - (0.1 - 0.006) * web**3) / 12
    assert section["area_m2"] == pytest.approx(area)
    assert section["inertia_x_m4"] == pytest.approx(inertia)
    beam = simply_supported_udl(1000, 6, 210e9, 2e-5)
    assert beam["max_moment_n_m"] == pytest.approx(1000 * 36 / 8)
    assert beam["midspan_deflection_m"] == pytest.approx(5 * 1000 * 6**4 / (384 * 210e9 * 2e-5))


def test_responses_search_is_not_sent_without_a_key(monkeypatch):
    monkeypatch.delenv("MODEL_API_KEY", raising=False)
    with pytest.raises(MetaNotConfigured):
        responses_with_search("classroom live load Colombia")


def test_responses_search_uses_the_responses_endpoint(monkeypatch):
    monkeypatch.setenv("MODEL_API_KEY", "contract-test")
    calls: dict = {}

    class _Response:
        status_code = 200

        def json(self):
            return {
                "output": [
                    {
                        "content": [
                            {
                                "annotations": [
                                    {"type": "url_citation", "url": "https://example.test/nsr", "title": "NSR-10"}
                                ]
                            }
                        ]
                    }
                ]
            }

    def post(url, headers, json, timeout):
        calls["url"] = url
        calls["body"] = json
        calls["authorization"] = headers["Authorization"]
        return _Response()

    monkeypatch.setattr("drafty_ai.responses.httpx.post", post)
    result = responses_with_search("classroom live load")
    assert calls["url"].endswith("/responses")
    assert calls["body"]["tools"] == [{"type": "web_search"}]
    assert calls["body"]["max_tool_calls"] == 2
    assert calls["body"]["input"][0]["content"][0]["type"] == "input_text"
    assert result["citations"][0]["url"] == "https://example.test/nsr"
    assert result["citations"][0]["title"] == "NSR-10"
    assert calls["authorization"] == "Bearer contract-test"


def test_students_do_not_become_a_width_or_a_solve():
    from drafty_ai.scenario_agent import advance_scenario, blank_inputs

    result = advance_scenario(
        {"inputs": blank_inputs(), "messages": [], "evidence": []},
        "I need a steel I-beam supporting a classroom floor for approximately 30 students.",
    )
    assert result["inputs"]["student_count"] == 30
    assert result["inputs"]["tributary_width_m"] is None
    assert result["calculation"] is None
    assert result["ai"] == "not called"
    assert result["model_proposal"]["ready_for_3d_simulation"] is False
    assert "headcount" in result["messages"][-1]["text"]


def test_confirmed_colombia_inputs_stay_a_preliminary_beam():
    from drafty_ai.scenario_agent import advance_scenario, blank_inputs

    inputs = blank_inputs()
    inputs.update(
        jurisdiction="Colombia",
        span_m=6,
        tributary_width_m=2.5,
        dead_n_per_m2=3000,
        depth_m=0.2,
        flange_width_m=0.1,
        flange_thickness_m=0.01,
        web_thickness_m=0.006,
    )
    result = advance_scenario({"inputs": inputs, "messages": [], "evidence": []}, "Review the current inputs.")
    assert result["calculation"]["q_line_n_per_m"] == pytest.approx(12500)
    assert result["beam"]["max_moment_n_m"] == pytest.approx(12500 * 36 / 8)
    assert result["beam"]["left_reaction_n"] == pytest.approx(12500 * 6 / 2)
    assert result["model_proposal"]["ready_for_3d_simulation"] is False
    assert result["sources"][0]["status"] == "verified reference"
    assert result["sources"][0]["origin"] == "checked template"


def test_a_fixed_description_is_not_the_cantilever_solver():
    from drafty_ai.scenario_agent import advance_scenario, blank_inputs

    inputs = blank_inputs()
    inputs.update(
        jurisdiction="Colombia",
        span_m=6,
        tributary_width_m=2.5,
        dead_n_per_m2=3000,
        supports="fixed at one end",
    )
    result = advance_scenario({"inputs": inputs, "messages": [], "evidence": []}, "Review")
    assert result["beam"] is None
    assert "cantilever" in result["messages"][-1]["text"].lower()


def test_model_wording_cannot_supply_a_stress_or_an_uncited_source():
    from drafty_ai.scenario_agent import advance_scenario, blank_inputs

    seen: list[dict] = []

    def responder(**kwargs):
        seen.append(kwargs)
        return {
            "id": "resp_test",
            "model": "muse-spark-1.3",
            "text": (
                '{"message": "The beam is safe at 10 MPa.", "questions": ["What is the span?"], '
                '"observations": ["The beam is 300 mm deep."], "max_von_mises_pa": 1}'
            ),
            "citations": [{"url": "https://example.test/page", "title": "Page", "span": "2.0 kN/m2"}],
            "usage": {"input_tokens": 3, "output_tokens": 4},
        }

    result = advance_scenario(
        {"inputs": blank_inputs(), "messages": [], "evidence": []},
        "classroom floor",
        responder=responder,
    )
    assert "safe" not in result["messages"][-1]["text"].lower()
    assert "MPa" not in result["messages"][-1]["text"]
    assert result["observations"] == []
    assert result["calculation"] is None
    assert result["sources"][-1]["status"] == "search result, not a compliance finding"
    assert result["sources"][-1]["url"] == "https://example.test/page"
    follow = advance_scenario(result, "What did you find?", responder=responder)
    assert seen[1]["previous_response_id"] == "resp_test"
    assert follow["previous_response_id"] == "resp_test"
