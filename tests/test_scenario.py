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
    assert result["citations"] == [{"url": "https://example.test/nsr", "title": "NSR-10"}]
    assert calls["authorization"] == "Bearer contract-test"
