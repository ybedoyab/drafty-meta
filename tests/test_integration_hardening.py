"""Integration hardening for catalog SoT, ambiguity, geometry cache, and deletion cleanup."""

import io
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from drafty_ai.scenario_agent import advance_scenario, blank_inputs
from drafty_api.main import app
from drafty_api.settings import settings
from drafty_engineering.catalog import AMBIGUOUS, scenario_input_names, scenario_parts
from drafty_engineering.plan import classify_request, route_tool
from drafty_engineering.revolved import evaluate_revolved, proposed_geometry_spec
from drafty_engineering.spec import RevolvedProfile

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


def test_blank_inputs_cover_every_catalog_field_and_keep_session_meta():
    fields = blank_inputs()
    catalog = scenario_input_names()
    assert catalog <= set(fields)
    for part in scenario_parts():
        for item in part.inputs:
            if item.kind == "number":
                assert fields[item.name] is None
            else:
                assert fields[item.name] == ""
    assert fields["domain"] == ""
    assert fields["physical_system"] == ""
    assert fields["requested_part"] == ""
    assert "student_count" in fields


def test_saved_scenario_keeps_extra_keys_when_catalog_grows(tmp_path, monkeypatch):
    with _client(tmp_path, monkeypatch) as client:
        created = client.post("/api/v1/scenarios").json()
        scenario_id = created["id"]
        path = Path(tmp_path) / "scenarios" / scenario_id / "session.json"
        session = json.loads(path.read_text(encoding="utf-8"))
        session["inputs"]["legacy_custom_note"] = "keep me"
        session["inputs"]["span_m"] = 6.0
        path.write_text(json.dumps(session), encoding="utf-8")
        fetched = client.get(f"/api/v1/scenarios/{scenario_id}").json()
        turned = client.post(
            f"/api/v1/scenarios/{scenario_id}/turn",
            json={"message": "Review the span.", "inputs": {"span_m": 6.0}},
        ).json()
    assert fetched["inputs"]["legacy_custom_note"] == "keep me"
    assert turned["inputs"]["legacy_custom_note"] == "keep me"
    assert turned["inputs"]["span_m"] == 6.0
    assert set(blank_inputs()) <= set(turned["inputs"]) or "legacy_custom_note" in turned["inputs"]


def test_ambiguous_keyword_hits_do_not_silently_pick_the_first_part():
    found = classify_request("Design a classroom floor bracket with mass optimization")
    assert found.domain == AMBIGUOUS
    assert found.system == AMBIGUOUS
    assert "classroom" in found.requested.lower() or "I-beam" in found.requested or "bracket" in found.requested
    assert "bracket" in found.requested.lower() or "L-bracket" in found.requested
    common = dict(domain=AMBIGUOUS, system=AMBIGUOUS, missing=[], has_analysis=False, has_spec=False)
    assert route_tool("create_supported_cad", **common)[1] == "rejected"
    assert route_tool("evaluate_beam", **common)[1] == "rejected"


def test_aluminum_still_disambiguates_bracket_from_classroom():
    found = classify_request("aluminum bracket for a classroom shelf")
    assert found[:2] == ("mechanical", "l_bracket")


def test_ambiguous_conversation_asks_which_part_and_builds_nothing():
    state = advance_scenario(
        {"inputs": blank_inputs(), "messages": [], "evidence": []},
        "Design a classroom floor bracket with mass optimization",
    )
    assert state["inputs"]["domain"] == AMBIGUOUS
    assert state["geometry_spec"] is None
    assert state["studio_spec"] is None
    assert state["phase"] == "unsupported"
    assert state["part_catalog"]["status"] == AMBIGUOUS
    assert "which" in " ".join(state.get("model_questions") or []).lower() or "Say which" in (
        state["messages"][-1]["text"] if state.get("messages") else ""
    )


def test_geometry_only_scenario_rejects_beam_analyze_and_jobs(tmp_path, monkeypatch):
    with _client(tmp_path, monkeypatch) as client:
        scenario_id = client.post("/api/v1/scenarios").json()["id"]
        client.post(
            f"/api/v1/scenarios/{scenario_id}/turn",
            json={"message": "Design a chess pawn 50 mm tall with a 28 mm base.", "inputs": {}},
        )
        analyzed = client.post(
            f"/api/v1/scenarios/{scenario_id}/analyze",
            json={
                "method": "euler-bernoulli",
                "inputs": {
                    "span_m": 6,
                    "tributary_width_m": 2.5,
                    "dead_n_per_m2": 3000,
                    "depth_m": 0.2,
                    "flange_width_m": 0.1,
                    "flange_thickness_m": 0.01,
                    "web_thickness_m": 0.006,
                    "supports": "simply supported",
                    "jurisdiction": "Colombia",
                },
            },
        )
        job = client.post(
            "/api/v1/jobs",
            json={
                "kind": "simulation",
                "compute": "local",
                "scenario_id": scenario_id,
                "spec": {
                    "name": "pawn-abuse",
                    "kind": "l_bracket",
                    "material_id": "aluminum_6061_t6",
                    "mesh_size_m": 0.004,
                    "bracket": {"leg_x_m": 0.08, "leg_z_m": 0.08, "thickness_m": 0.008, "width_m": 0.04},
                    "supports": [{"surface": "xmin", "constraint": "encastre"}],
                    "loads": [
                        {
                            "surface": "zmax",
                            "mode": "force",
                            "magnitude": 200.0,
                            "direction": {"x": 0.0, "y": 0.0, "z": -1.0},
                        }
                    ],
                },
            },
        )
    assert analyzed.status_code == 422
    assert "geometry only" in analyzed.json()["detail"].lower()
    assert job.status_code == 422
    assert "geometry only" in job.json()["detail"].lower()


def test_deleting_a_scenario_cleans_evidence_and_linked_jobs(tmp_path, monkeypatch):
    with _client(tmp_path, monkeypatch) as client:
        scenario_id = client.post("/api/v1/scenarios").json()["id"]
        uploaded = client.post(
            f"/api/v1/scenarios/{scenario_id}/evidence",
            files={"file": ("plan.png", io.BytesIO(PNG), "image/png")},
            data={"role": "drawing", "note": "cleanup"},
        )
        evidence_id = uploaded.json()["evidence"][0]["id"]
        evidence_path = Path(tmp_path) / "scenarios" / scenario_id / "evidence"
        assert any(evidence_path.glob(f"{evidence_id}.*"))

        session_path = Path(tmp_path) / "scenarios" / scenario_id / "session.json"
        session = json.loads(session_path.read_text(encoding="utf-8"))
        job_id = "11111111-1111-4111-8111-111111111111"
        job_dir = Path(tmp_path) / "jobs" / job_id
        job_dir.mkdir(parents=True)
        (job_dir / "job.json").write_text(
            json.dumps(
                {
                    "id": job_id,
                    "owner_id": session["owner_id"],
                    "kind": "simulation",
                    "status": "queued",
                    "message": "Queued",
                    "scenario_id": scenario_id,
                    "spec": {},
                    "options": {},
                    "created_at": "2026-01-01T00:00:00+00:00",
                    "updated_at": "2026-01-01T00:00:00+00:00",
                }
            ),
            encoding="utf-8",
        )
        session["jobs"] = [{"id": job_id, "kind": "simulation"}]
        session_path.write_text(json.dumps(session), encoding="utf-8")

        deleted = client.delete(f"/api/v1/scenarios/{scenario_id}")
        missing = client.get(f"/api/v1/scenarios/{scenario_id}")
    assert deleted.status_code == 200
    assert deleted.json()["cleanup"]["jobs_removed"] >= 1
    assert deleted.json()["cleanup"]["geometry_cache"] == "retained"
    assert missing.status_code == 404
    assert not (Path(tmp_path) / "scenarios" / scenario_id).exists()
    assert not job_dir.exists()


@pytest.mark.cad
def test_geometry_cache_is_content_addressed_immutable_and_charged_once(tmp_path, monkeypatch):
    from drafty_api.geometry_cache import load_or_build_geometry, profile_digest, read_local_cache

    monkeypatch.setattr(settings, "drafty_data_dir", str(tmp_path))
    monkeypatch.setattr(settings, "drafty_max_previews_per_hour", 2)
    inputs = {"overall_height_m": 0.05, "base_diameter_m": 0.028}
    study = evaluate_revolved(inputs)
    profile = RevolvedProfile.model_validate(proposed_geometry_spec(inputs)["profile"])
    assert study["ready_for_cad"] is True
    first, hit1 = load_or_build_geometry(profile, "owner-a")
    second, hit2 = load_or_build_geometry(profile, "owner-a")
    third, hit3 = load_or_build_geometry(profile, "owner-b")
    digest = profile_digest(profile)
    cached = read_local_cache(digest)
    assert hit1 is False
    assert hit2 is True and hit3 is True
    assert first["model.stl"] == second["model.stl"] == third["model.stl"]
    assert cached is not None
    assert len(digest) == 64
    manifest = json.loads((Path(tmp_path) / "geometry" / digest / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["immutable"] is True
    assert manifest["digest"] == digest
    # Corrupt an existing file: reader must reject rather than serve bad bytes.
    stl_path = Path(tmp_path) / "geometry" / digest / "model.stl"
    stl_path.write_bytes(b"not-a-real-stl")
    assert read_local_cache(digest) is None


@pytest.mark.cad
def test_production_style_geometry_cache_hit_skips_modal(tmp_path, monkeypatch):
    from drafty_api.geometry_cache import load_or_build_geometry, profile_digest, write_local_cache
    from drafty_engineering.cad import export_revolved

    monkeypatch.setattr(settings, "drafty_data_dir", str(tmp_path))
    monkeypatch.setattr(settings, "drafty_env", "production")
    monkeypatch.setattr(settings, "supabase_url", "")
    profile = RevolvedProfile.model_validate(
        proposed_geometry_spec({"overall_height_m": 0.05, "base_diameter_m": 0.028})["profile"]
    )
    staging = Path(tmp_path) / "seed"
    paths = export_revolved(profile, staging)
    files = {name: path.read_bytes() for name, path in paths.items()}
    write_local_cache(profile_digest(profile), files)

    calls = {"modal": 0, "charge": 0}

    def _remote(_profile):
        calls["modal"] += 1
        raise AssertionError("Modal must not run on a cache hit")

    def _charge(_owner):
        calls["charge"] += 1
        raise AssertionError("Preview quota must not charge on a cache hit")

    monkeypatch.setattr("drafty_api.remote.remote_geometry", _remote)
    monkeypatch.setattr("drafty_api.jobs.charge_preview", _charge)
    loaded, hit = load_or_build_geometry(profile, "owner-prod")
    assert hit is True
    assert loaded["preview.glb"][:4] == b"glTF"
    assert calls == {"modal": 0, "charge": 0}


@pytest.mark.cad
def test_scenario_geometry_route_reports_cache_headers(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "drafty_data_dir", str(tmp_path))
    monkeypatch.setattr("drafty_ai.scenario_agent.configured", lambda: False)
    monkeypatch.setattr("drafty_api.scenarios.configured", lambda: False)
    with TestClient(app) as client:
        scenario_id = client.post("/api/v1/scenarios").json()["id"]
        client.post(
            f"/api/v1/scenarios/{scenario_id}/turn",
            json={"message": "Design a chess pawn 50 mm tall with a 28 mm base.", "inputs": {}},
        )
        first = client.get(f"/api/v1/scenarios/{scenario_id}/geometry/model.stl")
        second = client.get(f"/api/v1/scenarios/{scenario_id}/geometry/model.stl")
    assert first.status_code == 200
    assert second.status_code == 200
    assert first.headers.get("x-drafty-geometry-cache") == "miss"
    assert second.headers.get("x-drafty-geometry-cache") == "hit"
    assert len(first.headers.get("x-drafty-geometry-digest", "")) == 64
    assert first.content == second.content
