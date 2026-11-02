import json
import math

import pytest
from pydantic import ValidationError

from drafty_ai.scenario_agent import advance_scenario, blank_inputs
from drafty_engineering.catalog import PARTS
from drafty_engineering.plan import classify_request, route_tool
from drafty_engineering.revolved import (
    PAWN_ASPECT_LIMITS,
    STAUNTON_PAWN_BODY,
    staunton_pawn_points,
    staunton_pawn_profile,
)
from drafty_engineering.spec import ProfilePoint, RevolvedProfile

PAWN_REQUEST = "I want to design a basic chess pawn to render in 3D."
PAWN_ANSWER = "Staunton pawn, 50 mm tall, 28 mm base, STEP, decorative PLA."


def _profile(*points: tuple[float, float]) -> RevolvedProfile:
    return RevolvedProfile(points=[ProfilePoint(height_m=h, radius_m=r) for h, r in points])


def _frustums(points: list[tuple[float, float]]) -> float:
    return sum(
        math.pi * (h2 - h1) / 3.0 * (r1 * r1 + r1 * r2 + r2 * r2) for (h1, r1), (h2, r2) in zip(points, points[1:])
    )


def test_a_cylinder_and_a_cone_have_their_closed_form_volumes():
    cylinder = _profile((0.0, 0.01), (0.02, 0.01), (0.04, 0.01))
    cone = _profile((0.0, 0.01), (0.015, 0.005), (0.03, 0.0))
    assert cylinder.volume_m3() == pytest.approx(math.pi * 0.01**2 * 0.04)
    assert cone.volume_m3() == pytest.approx(math.pi * 0.01**2 * 0.03 / 3.0)
    assert cone.outline() == [(0.0, 0.0), (0.01, 0.0), (0.005, 0.015), (0.0, 0.03)]


@pytest.mark.parametrize(
    ("points", "message"),
    [
        (((0.0, 0.01), (0.01, 0.01), (0.01, 0.008)), "increase"),
        (((0.0, 0.01), (0.02, 0.01), (0.01, 0.01)), "increase"),
        (((0.0, 0.01), (0.01, 0.0), (0.02, 0.01)), "Only the first and last points may sit on the axis"),
        (((0.0, 0.0), (0.001, 0.0), (0.002, 0.0)), "Only the first and last points"),
        (((-0.01, 0.01), (0.0, 0.01), (0.01, 0.01)), "z = 0"),
        (((0.0, 0.01), (0.3, 0.01), (0.6, 0.01)), "between"),
        (((0.0, 0.3), (0.01, 0.3), (0.02, 0.3)), "radius must not exceed"),
        (((0.0, 0.001), (0.0005, 0.001), (0.001, 0.001)), "between"),
        (((0.0, 0.01), (float("nan"), 0.01), (0.02, 0.01)), "finite"),
    ],
)
def test_an_invalid_profile_is_rejected(points, message):
    with pytest.raises(ValidationError, match=message):
        _profile(*points)


def test_a_negative_radius_and_too_few_points_are_rejected():
    with pytest.raises(ValidationError):
        _profile((0.0, 0.01), (0.01, -0.002), (0.02, 0.01))
    with pytest.raises(ValidationError):
        _profile((0.0, 0.01), (0.01, 0.0))


def test_the_pawn_preset_scales_stored_proportions_to_the_users_size():
    profile = staunton_pawn_profile(0.05, 0.028)
    assert profile.height_m == pytest.approx(0.05)
    assert profile.max_radius_m == pytest.approx(0.014)
    assert profile.points[0].height_m == 0.0
    assert profile.points[-1].radius_m == 0.0
    normalised = staunton_pawn_points()
    assert normalised[: len(STAUNTON_PAWN_BODY)] == list(STAUNTON_PAWN_BODY)
    for point, (h, r) in zip(profile.points, normalised):
        assert point.height_m == pytest.approx(h * 0.05)
        assert point.radius_m == pytest.approx(r * 0.014)
    expected = _frustums([(p.height_m, p.radius_m) for p in profile.points])
    assert profile.volume_m3() == pytest.approx(expected)


@pytest.mark.parametrize(
    ("height", "diameter", "message"),
    [
        (0.005, 0.003, "height must be between"),
        (0.5, 0.25, "height must be between"),
        (0.05, 0.05, "Height divided by base diameter"),
        (0.05, 0.01, "Height divided by base diameter"),
        (0.05, 0.0, "positive"),
    ],
)
def test_the_pawn_preset_rejects_sizes_outside_its_limits(height, diameter, message):
    with pytest.raises(ValueError, match=message):
        staunton_pawn_profile(height, diameter)


def test_both_aspect_limits_build_a_valid_profile():
    for aspect in PAWN_ASPECT_LIMITS:
        staunton_pawn_profile(0.05, 0.05 / aspect)


def test_the_registry_marks_the_revolved_part_geometry_only():
    part = PARTS["revolved_profile"]
    assert part.analysis == ("none",)
    assert {"STEP", "STL"} <= set(part.exports)
    assert part.studio_kind is None
    assert classify_request(PAWN_REQUEST)[:2] == ("geometry", "revolved_profile")
    common = dict(domain="geometry", system="revolved_profile", missing=[], has_analysis=False, has_spec=True)
    assert route_tool("run_supported_simulation", **common)[1] == "rejected"
    assert route_tool("evaluate_beam", **common)[1] == "rejected"
    assert route_tool(None, **common) == ("create_supported_cad", "ok")


def _responder(message: str):
    def responder(**_kwargs):
        return {
            "id": "resp_pawn",
            "model": "muse-spark-1.3",
            "text": json.dumps(
                {
                    "message": message,
                    "questions": [],
                    "observations": [],
                    "domain": "geometry",
                    "physical_system": "revolved_profile",
                    "tool": "create_supported_cad",
                    "claims": [],
                }
            ),
            "citations": [],
            "usage": {"output_tokens": 4},
        }

    return responder


def test_the_pawn_conversation_builds_a_profile_and_says_no_check_ran():
    asked = advance_scenario({"inputs": blank_inputs(), "messages": [], "evidence": []}, PAWN_REQUEST)
    assert asked["missing"] == ["overall height", "base diameter"]
    assert asked["geometry_spec"] is None
    assert asked["part_catalog"]["form_part"]["id"] == "revolved_profile"
    built = advance_scenario(
        asked,
        PAWN_ANSWER,
        responder=_responder("Your pawn is 50 mm tall with a 28 mm base. The profile is ready."),
    )
    text = built["messages"][-1]["text"]
    assert built["inputs"]["overall_height_m"] == pytest.approx(0.05)
    assert built["inputs"]["base_diameter_m"] == pytest.approx(0.028)
    assert built["missing"] == []
    assert built["studio_spec"] is None
    assert built["geometry_spec"]["kind"] == "revolved_profile"
    assert built["geometry_spec"]["volume_m3"] == pytest.approx(staunton_pawn_profile(0.05, 0.028).volume_m3())
    assert "no structural check was run" in text
    assert "not a stored engineering result" not in text
    assert built["engineering"]["simulator"] == "none"
    assert built["engineering"]["validation_status"] == "ready"
    assert built["tool_trace"][0]["tool"] == "create_supported_cad"
    assert built["tool_trace"][0]["status"] == "executed"
    assert built["tool_trace"][0]["output"]["started"] is False
    assert not built["rejected_claims"]


def test_a_pawn_outside_the_preset_limits_creates_nothing():
    result = advance_scenario(
        {"inputs": blank_inputs(), "messages": [], "evidence": []},
        "Design a chess pawn 50 mm tall with a 50 mm base.",
    )
    assert result["geometry_spec"] is None
    assert "Height divided by base diameter" in result["messages"][-1]["text"]
    assert "no structural check was run" in result["messages"][-1]["text"]


@pytest.mark.cad
def test_the_revolved_solid_matches_the_profile_volume_and_exports(tmp_path):
    import cadquery as cq
    import trimesh

    from drafty_engineering.cad import build_revolved, export_revolved, solid_volume

    profile = staunton_pawn_profile(0.05, 0.028)
    solid = build_revolved(profile)
    assert solid_volume(solid) == pytest.approx(profile.volume_m3(), rel=1e-6)
    bounds = solid.val().BoundingBox()
    assert (bounds.xmax - bounds.xmin) == pytest.approx(0.028, abs=1e-7)
    assert bounds.zmin == pytest.approx(0.0, abs=1e-9)
    assert bounds.zmax == pytest.approx(0.05, abs=1e-9)
    paths = export_revolved(profile, tmp_path)
    for name in ("model.step", "model.stl", "preview.glb"):
        assert paths[name].is_file() and paths[name].stat().st_size > 0
    mesh = trimesh.load(paths["model.stl"])
    assert mesh.is_watertight
    assert mesh.extents[2] == pytest.approx(50.0, rel=1e-3)
    assert mesh.volume == pytest.approx(profile.volume_m3() * 1e9, rel=5e-3)
    step = paths["model.step"].read_text(encoding="utf-8", errors="ignore")
    assert "SI_UNIT(.MILLI.,.METRE.)" in step
    reloaded = cq.importers.importStep(str(paths["model.step"]))
    assert reloaded.val().Volume() == pytest.approx(profile.volume_m3() * 1e9, rel=1e-4)


@pytest.mark.cad
def test_the_scenario_geometry_route_serves_the_files(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from drafty_api.main import app
    from drafty_api.settings import settings

    monkeypatch.setattr(settings, "drafty_data_dir", str(tmp_path))
    monkeypatch.setattr("drafty_ai.scenario_agent.configured", lambda: False)
    monkeypatch.setattr("drafty_api.scenarios.configured", lambda: False)
    with TestClient(app) as client:
        scenario_id = client.post("/api/v1/scenarios").json()["id"]
        empty = client.get(f"/api/v1/scenarios/{scenario_id}/geometry/model.step")
        turn = client.post(
            f"/api/v1/scenarios/{scenario_id}/turn",
            json={"message": "Design a chess pawn 50 mm tall with a 28 mm base.", "inputs": {}},
        )
        stl = client.get(f"/api/v1/scenarios/{scenario_id}/geometry/model.stl")
        step = client.get(f"/api/v1/scenarios/{scenario_id}/geometry/model.step")
        glb = client.get(f"/api/v1/scenarios/{scenario_id}/geometry/preview.glb")
        again = client.get(f"/api/v1/scenarios/{scenario_id}/geometry/model.stl")
        other = client.get(f"/api/v1/scenarios/{scenario_id}/geometry/model.inp")
    assert empty.status_code == 404
    assert turn.json()["geometry_spec"]["preset"] == "staunton_pawn"
    assert turn.json()["part_catalog"]["active_part"]["id"] == "revolved_profile"
    assert stl.status_code == 200 and len(stl.content) > 1000
    assert 'filename="staunton-pawn.stl"' in stl.headers["content-disposition"]
    assert step.status_code == 200 and b"ISO-10303-21" in step.content[:100]
    assert glb.status_code == 200 and glb.content[:4] == b"glTF"
    assert again.content == stl.content
    assert other.status_code == 404
