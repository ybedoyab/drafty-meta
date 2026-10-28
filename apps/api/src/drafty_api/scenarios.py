"""Scenario sessions. Images stay on disk. Numbers come from the engineering package."""

import hashlib
import json
import uuid
from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from drafty_ai.client import configured
from drafty_ai.scenario_agent import advance_scenario, blank_inputs
from drafty_api.auth import current_owner
from drafty_api.images import inspect_image
from drafty_api.settings import settings
from drafty_engineering.beam_fem import analyze_simply_supported_udl
from drafty_engineering.scenario import classroom_kwargs, evaluate_classroom

router = APIRouter()
MAX_IMAGES = 8
MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_VISION_BYTES = 4 * 1024 * 1024
ROLES = {"context", "drawing", "photo", "screenshot"}
EXTENSIONS = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}


class ScenarioInputs(BaseModel):
    jurisdiction: str = ""
    span_m: float | None = None
    tributary_width_m: float | None = None
    dead_n_per_m2: float | None = None
    live_n_per_m2: float | None = None
    beam_self_weight_n_per_m: float | None = None
    depth_m: float | None = None
    flange_width_m: float | None = None
    flange_thickness_m: float | None = None
    web_thickness_m: float | None = None
    student_count: int | None = None
    supports: str = ""


class TurnBody(BaseModel):
    message: str = ""
    inputs: ScenarioInputs = Field(default_factory=ScenarioInputs)
    model: str | None = None


class AnalyzeBody(BaseModel):
    method: str = "euler-bernoulli"
    elements: int = Field(default=16, ge=2, le=64)
    compare: bool = False
    inputs: ScenarioInputs = Field(default_factory=ScenarioInputs)


def scenario_dir(scenario_id: str) -> Path:
    try:
        if str(uuid.UUID(scenario_id)) != scenario_id:
            raise ValueError
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Scenario not found.") from exc
    return settings.data_dir / "scenarios" / scenario_id


def read_scenario(scenario_id: str, owner_id: str) -> dict:
    path = scenario_dir(scenario_id) / "session.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Scenario not found.")
    session = json.loads(path.read_text(encoding="utf-8"))
    if session.get("owner_id") != owner_id:
        raise HTTPException(status_code=404, detail="Scenario not found.")
    return session


def _write(session: dict) -> None:
    directory = scenario_dir(session["id"])
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "session.json").write_text(json.dumps(session), encoding="utf-8")


def _public(session: dict) -> dict:
    shown = dict(session)
    shown.pop("owner_id", None)
    return shown


@router.post("/api/v1/scenarios")
def create_scenario(request: Request) -> dict:
    owner = current_owner(request)
    scenario_id = str(uuid.uuid4())
    session = {
        "id": scenario_id,
        "owner_id": owner,
        "created_at": datetime.now(UTC).isoformat(),
        "updated_at": datetime.now(UTC).isoformat(),
        "inputs": blank_inputs(),
        "messages": [],
        "evidence": [],
        "missing": [],
        "workflow": "understand",
        "errors": [],
        "assumptions": [],
        "sources": [],
        "calculation": None,
        "section": None,
        "beam": None,
        "model_proposal": {
            "family": "unset",
            "ready_for_3d_simulation": False,
            "ready_for_beam_elements": False,
            "reason": "Describe the problem before any model is proposed.",
        },
        "verification": [],
        "model_questions": [],
        "observations": [],
        "mode": "offline-template",
        "model": None,
        "previous_response_id": None,
        "usage": None,
        "meta_turns": 0,
        "output_tokens": 0,
        "context_reset": False,
        "phase": "collecting",
        "analysis": None,
        "comparison": None,
        "ai": "not called",
    }
    _write(session)
    return _public(session)


@router.get("/api/v1/scenarios/{scenario_id}")
def get_scenario(scenario_id: str, request: Request) -> dict:
    return _public(read_scenario(scenario_id, current_owner(request)))


@router.post("/api/v1/scenarios/{scenario_id}/turn")
def scenario_turn(scenario_id: str, body: TurnBody, request: Request) -> dict:
    session = read_scenario(scenario_id, current_owner(request))
    merged = _merge_inputs(session, body.inputs.model_dump())
    urls, withheld = _vision_urls(session) if configured() else ([], False)
    updated = advance_scenario(
        {**session, "inputs": merged},
        body.message,
        image_data_urls=urls,
        model=body.model,
    )
    if withheld and updated["messages"]:
        updated["messages"][-1]["text"] += " The images stayed in storage because this turn's vision cap is 4 MB."
    session.update(updated)
    session["updated_at"] = datetime.now(UTC).isoformat()
    _write(session)
    return _public(session)


class SegmentBody(BaseModel):
    evidence_id: str
    prompt: str = ""


@router.post("/api/v1/scenarios/{scenario_id}/approve")
def approve_model(scenario_id: str, request: Request) -> dict:
    session = read_scenario(scenario_id, current_owner(request))
    if not session.get("studio_spec"):
        raise HTTPException(status_code=422, detail="There is no CAD model to approve.")
    session["studio_approval"] = "confirmed"
    messages = list(session.get("messages") or [])
    messages.append({"role": "user", "text": "The CAD model was approved for Studio."})
    messages.append(
        {
            "role": "assistant",
            "text": (
                "The L-bracket was handed to Studio. CalculiX has not started. "
                "Run the solid solve there if the faces and the force are the ones you want."
            ),
        }
    )
    session["messages"] = messages[-40:]
    session["updated_at"] = datetime.now(UTC).isoformat()
    _write(session)
    return _public(session)


@router.post("/api/v1/scenarios/{scenario_id}/reject")
def reject_model(scenario_id: str, request: Request) -> dict:
    session = read_scenario(scenario_id, current_owner(request))
    if not session.get("studio_spec"):
        raise HTTPException(status_code=422, detail="There is no CAD model to reject.")
    session["studio_approval"] = "rejected"
    messages = list(session.get("messages") or [])
    messages.append({"role": "user", "text": "The proposed CAD model was rejected."})
    messages.append(
        {
            "role": "assistant",
            "text": "The proposal stays on this page and was not sent to CalculiX. Revise the inputs and send again.",
        }
    )
    session["messages"] = messages[-40:]
    session["updated_at"] = datetime.now(UTC).isoformat()
    _write(session)
    return _public(session)


@router.post("/api/v1/scenarios/{scenario_id}/segment")
def segment_evidence(scenario_id: str, body: SegmentBody, request: Request) -> dict:
    from drafty_ai.client import MetaNotConfigured, MetaRequestError
    from drafty_ai.segmentation import segment_image

    session = read_scenario(scenario_id, current_owner(request))
    item = next((entry for entry in session["evidence"] if entry["id"] == body.evidence_id), None)
    if item is None:
        raise HTTPException(status_code=404, detail="Image not found.")
    urls, _withheld = _vision_urls({"id": session["id"], "evidence": [item]})
    if not urls:
        raise HTTPException(status_code=422, detail="That image could not be prepared for segmentation.")
    try:
        result = segment_image(body.prompt, urls[0])
    except MetaNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except MetaRequestError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="The segmentation output could not be read.") from exc
    session["segmentation"] = {**result, "evidence_id": body.evidence_id}
    session["updated_at"] = datetime.now(UTC).isoformat()
    _write(session)
    return _public(session)


@router.post("/api/v1/scenarios/{scenario_id}/dismiss")
def dismiss_suggestion(scenario_id: str, request: Request) -> dict:
    session = read_scenario(scenario_id, current_owner(request))
    session["model_questions"] = []
    session["observations"] = []
    messages = list(session.get("messages") or [])
    messages.append({"role": "user", "text": "The suggestion was rejected."})
    messages.append(
        {
            "role": "assistant",
            "text": "The suggestion was set aside. Typed inputs and calculated numbers were kept.",
        }
    )
    session["messages"] = messages[-40:]
    session["updated_at"] = datetime.now(UTC).isoformat()
    _write(session)
    return _public(session)


@router.post("/api/v1/scenarios/{scenario_id}/analyze")
def analyze_scenario(scenario_id: str, body: AnalyzeBody, request: Request) -> dict:
    session = read_scenario(scenario_id, current_owner(request))
    if body.method != "euler-bernoulli":
        raise HTTPException(
            status_code=422,
            detail=(
                "Only Euler-Bernoulli beam elements are enabled. The solid solver is not this beam, "
                "and a simply supported span is not converted into the cantilever."
            ),
        )
    if body.compare and not session.get("analysis"):
        raise HTTPException(status_code=422, detail="Run the confirmed beam before comparing an edit.")
    merged = _merge_inputs(session, body.inputs.model_dump())
    try:
        solved = _beam_record(merged, body.elements)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    solved["inputs"] = merged
    solved["stale"] = False
    if body.compare:
        session["comparison"] = solved
    else:
        session["analysis"] = solved
        session["comparison"] = None
        session["inputs"] = merged
        session["phase"] = "verifying"
        _apply_study(session, merged)
    session["updated_at"] = datetime.now(UTC).isoformat()
    _write(session)
    return _public(session)


@router.get("/api/v1/scenarios/{scenario_id}/report")
def scenario_report(scenario_id: str, request: Request) -> dict:
    session = read_scenario(scenario_id, current_owner(request))
    analysis = session.get("analysis")
    if not analysis or analysis.get("stale"):
        raise HTTPException(status_code=404, detail="There is no current beam-element report.")
    return {
        "report": "drafty-beam-element",
        "scenario_id": session["id"],
        "certification": "not claimed",
        "analysis": analysis,
        "comparison": session.get("comparison"),
        "assumptions": session.get("assumptions") or [],
        "sources": session.get("sources") or [],
        "verification": session.get("verification") or [],
    }


@router.post("/api/v1/scenarios/{scenario_id}/evidence")
async def add_evidence(
    scenario_id: str,
    request: Request,
    file: UploadFile = File(...),
    role: str = Form("context"),
    note: str = Form(""),
) -> dict:
    owner = current_owner(request)
    session = read_scenario(scenario_id, owner)
    if role not in ROLES:
        raise HTTPException(status_code=422, detail="Image role must be context, drawing, photo, or screenshot.")
    if len(session["evidence"]) >= MAX_IMAGES:
        raise HTTPException(status_code=422, detail="A scenario keeps at most eight images.")
    data = await file.read()
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=422, detail="Each image is limited to 8 MB.")
    try:
        media, width, height = inspect_image(data)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    evidence_id = str(uuid.uuid4())
    directory = scenario_dir(scenario_id) / "evidence"
    directory.mkdir(parents=True, exist_ok=True)
    (directory / f"{evidence_id}{EXTENSIONS[media]}").write_bytes(data)
    item = {
        "id": evidence_id,
        "name": Path(file.filename or "image").name[:120],
        "media_type": media,
        "byte_length": len(data),
        "width_px": width,
        "height_px": height,
        "sha256": hashlib.sha256(data).hexdigest(),
        "role": role,
        "note": note.strip()[:200],
        "limit": "An image is evidence. It is not a dimensional survey.",
    }
    (directory / f"{evidence_id}.json").write_text(json.dumps({"owner_id": owner}), encoding="utf-8")
    session["evidence"].append(item)
    session["updated_at"] = datetime.now(UTC).isoformat()
    _write(session)
    return _public(session)


@router.delete("/api/v1/scenarios/{scenario_id}/evidence/{evidence_id}")
def remove_evidence(scenario_id: str, evidence_id: str, request: Request) -> dict:
    session = read_scenario(scenario_id, current_owner(request))
    _evidence_id(evidence_id)
    kept = [item for item in session["evidence"] if item["id"] != evidence_id]
    if len(kept) == len(session["evidence"]):
        raise HTTPException(status_code=404, detail="Image not found.")
    directory = scenario_dir(scenario_id) / "evidence"
    for path in directory.glob(f"{evidence_id}.*"):
        path.unlink(missing_ok=True)
    session["evidence"] = kept
    session["updated_at"] = datetime.now(UTC).isoformat()
    _write(session)
    return _public(session)


@router.get("/api/v1/scenarios/{scenario_id}/evidence/{evidence_id}")
def get_evidence(scenario_id: str, evidence_id: str, request: Request) -> FileResponse:
    session = read_scenario(scenario_id, current_owner(request))
    _evidence_id(evidence_id)
    item = next((entry for entry in session["evidence"] if entry["id"] == evidence_id), None)
    if item is None:
        raise HTTPException(status_code=404, detail="Image not found.")
    path = scenario_dir(scenario_id) / "evidence" / f"{evidence_id}{EXTENSIONS[item['media_type']]}"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Image not found.")
    return FileResponse(path, media_type=item["media_type"], filename=item["name"])


def _merge_inputs(session: dict, incoming: dict) -> dict:
    merged = dict(session.get("inputs") or blank_inputs())
    for key, value in incoming.items():
        if key == "student_count":
            continue
        merged[key] = value
    return merged


def _beam_record(inputs: dict, elements: int) -> dict:
    study = evaluate_classroom(**classroom_kwargs(inputs))
    if study["errors"]:
        raise ValueError(study["errors"][0])
    if not study["ready_for_beam_elements"] or study["beam"] is None or study["line"] is None:
        raise ValueError(study["reason"])
    material = study["beam"]["material"]
    record = analyze_simply_supported_udl(
        load_n_per_m=study["line"]["q_line_n_per_m"],
        span_m=inputs["span_m"],
        youngs_modulus_pa=material["youngs_modulus_pa"],
        inertia_m4=study["section"]["inertia_x_m4"],
        depth_m=inputs["depth_m"],
        elements=elements,
        yield_strength_pa=material["yield_strength_pa"],
    )
    record["material"] = material
    record["section"] = study["section"]
    record["load"] = {
        "q_line_n_per_m": study["line"]["q_line_n_per_m"],
        "live_n_per_m2": study["line"]["live_n_per_m2"],
        "trace": study["line"]["trace"],
        "citation": study["line"].get("citation"),
    }
    record["assumptions"] = [
        *record["assumptions"],
        (
            f"Young's modulus is {material['youngs_modulus_pa']} Pa for {material['name']}. "
            f"{material['source']}. {material['caveat']}"
        ),
    ]
    record["limitations"] = [
        *record["limitations"],
        "Yield strength is recorded with the material and is not used as a pass or fail.",
    ]
    if record["elastic_range"] == "above typical yield":
        record["limitations"].append(
            "The elastic outer-fiber stress is above the typical yield stored for this material, "
            "so this elastic model is outside the range where that stress remains meaningful. Strength is not checked."
        )
    return record


def _apply_study(session: dict, inputs: dict) -> None:
    study = evaluate_classroom(**classroom_kwargs(inputs))
    kept = [item for item in session.get("sources") or [] if item.get("origin") != "checked template"]
    session["calculation"] = study["line"]
    session["section"] = study["section"]
    session["beam"] = study["beam"]
    session["missing"] = study["missing"]
    session["errors"] = study["errors"]
    session["assumptions"] = study["assumptions"]
    session["sources"] = [*study["sources"], *kept]
    session["verification"] = study["verification"]
    session["model_proposal"] = {
        "family": "simply supported classroom I-beam, preliminary",
        "ready_for_3d_simulation": False,
        "ready_for_beam_elements": study["ready_for_beam_elements"],
        "reason": study["reason"],
    }


def _evidence_id(evidence_id: str) -> None:
    try:
        if str(uuid.UUID(evidence_id)) != evidence_id:
            raise ValueError
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Image not found.") from exc


def _vision_urls(session: dict) -> tuple[list[str], bool]:
    import base64

    urls: list[str] = []
    total = 0
    withheld = False
    directory = scenario_dir(session["id"]) / "evidence"
    for item in session["evidence"]:
        path = directory / f"{item['id']}{EXTENSIONS[item['media_type']]}"
        if not path.exists():
            continue
        data = path.read_bytes()
        if total + len(data) > MAX_VISION_BYTES:
            withheld = True
            break
        total += len(data)
        encoded = base64.b64encode(data).decode("ascii")
        urls.append(f"data:{item['media_type']};base64,{encoded}")
    return urls, withheld
