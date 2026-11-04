"""Scenario sessions. Images stay on disk. Numbers come from the engineering package."""

import hashlib
import json
import math
import shutil
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, RedirectResponse, Response
from pydantic import BaseModel, Field, ValidationError

from drafty_ai.client import ALLOWED_MODELS, DEFAULT_MODEL, configured, model_catalog
from drafty_ai.scenario_agent import advance_scenario, blank_inputs
from drafty_api.auth import current_access_token, current_owner
from drafty_api.images import inspect_image
from drafty_api.settings import settings
from drafty_api.storage import (
    delete_private_object,
    delete_remote_scenario,
    download_private_object,
    fetch_scenario,
    list_remote_scenarios,
    mirror_scenario,
    signed_object_url,
    upload_private_object,
)
from drafty_engineering.artifacts import MAX_ARTIFACT_BYTES
from drafty_engineering.beam_fem import analyze_simply_supported_udl
from drafty_engineering.catalog import PARTS, catalog_view, get_part, scenario_parts
from drafty_engineering.demos import bracket_record, classroom_record
from drafty_engineering.plan import (
    apply_studio_spec,
    build_scenario,
    describe_studio_changes,
    evaluate_mechanical,
    proposed_studio_spec,
    workflow_stage,
)
from drafty_engineering.scenario import classroom_kwargs, evaluate_classroom
from drafty_engineering.spec import DesignSpec, RevolvedProfile

router = APIRouter()
MAX_IMAGES = 8
MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_VISION_BYTES = 4 * 1024 * 1024
ROLES = {"context", "drawing", "photo", "screenshot"}
EXTENSIONS = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}
GEOMETRY_FILES = {"preview.glb": "model/gltf-binary", "model.step": "model/step", "model.stl": "model/stl"}


class TurnBody(BaseModel):
    message: str = ""
    inputs: dict[str, Any] = Field(default_factory=dict)
    model: str | None = None


class RenameBody(BaseModel):
    name: str = ""


class AnalyzeBody(BaseModel):
    method: str = "euler-bernoulli"
    elements: int = Field(default=16, ge=2, le=64)
    compare: bool = False
    inputs: dict[str, Any] = Field(default_factory=dict)


def clean_inputs(raw: dict[str, Any]) -> dict:
    """Keep only inputs the registry lists, typed as the registry says. Faces use their own route."""

    fields = {item.name: item for part in scenario_parts() for item in part.inputs}
    cleaned: dict = {}
    for key, value in raw.items():
        field = fields.get(key)
        if field is None or field.kind == "face":
            continue
        if field.kind == "number":
            if value is None:
                cleaned[key] = None
                continue
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                raise HTTPException(status_code=422, detail=f"{field.label} must be a finite number in {field.unit}.")
            cleaned[key] = float(value)
            continue
        text = "" if value is None else str(value).strip()[:200]
        if field.kind == "choice" and text and text not in field.choices:
            raise HTTPException(status_code=422, detail=f"{field.label} must be one of {', '.join(field.choices)}.")
        cleaned[key] = text
    return cleaned


def scenario_dir(scenario_id: str) -> Path:
    try:
        if str(uuid.UUID(scenario_id)) != scenario_id:
            raise ValueError
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Scenario not found.") from exc
    return settings.data_dir / "scenarios" / scenario_id


def read_scenario(scenario_id: str, owner_id: str) -> dict:
    if settings.production:
        remote = _remote_session(scenario_id, owner_id)
        if remote is None:
            raise HTTPException(status_code=404, detail="Scenario not found.")
        return remote
    path = scenario_dir(scenario_id) / "session.json"
    if not path.exists():
        remote = _remote_session(scenario_id, owner_id)
        if remote is None:
            raise HTTPException(status_code=404, detail="Scenario not found.")
        _write(remote, mirror=False)
        return remote
    session = json.loads(path.read_text(encoding="utf-8"))
    if session.get("owner_id") != owner_id:
        raise HTTPException(status_code=404, detail="Scenario not found.")
    return session


def _remote_session(scenario_id: str, owner_id: str) -> dict | None:
    try:
        remote = fetch_scenario(scenario_id, current_access_token())
    except Exception:
        return None
    if remote is None or remote.get("owner_id") != owner_id:
        return None
    return remote


def _write(session: dict, snapshot: bool = False, mirror: bool = True) -> None:
    directory = scenario_dir(session["id"])
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "session.json").write_text(json.dumps(session), encoding="utf-8")
    if not mirror:
        return
    try:
        stored = mirror_scenario(session, current_access_token(), snapshot=snapshot)
    except Exception as exc:
        status = getattr(getattr(exc, "response", None), "status_code", None)
        if settings.production:
            raise HTTPException(status_code=503, detail="The scenario was not saved.") from exc
        (directory / "sync.log").write_text(
            f"scenario mirror failed: {status or type(exc).__name__}\n",
            encoding="utf-8",
        )
        return
    if settings.production and not stored:
        raise HTTPException(status_code=503, detail="The scenario was not saved.")


def _public(session: dict) -> dict:
    shown = dict(session)
    shown.pop("owner_id", None)
    inputs = shown.get("inputs") or {}
    shown["part_catalog"] = catalog_view(inputs.get("physical_system"), inputs.get("requested_part"))
    return shown


@router.get("/api/v1/models")
def list_models() -> dict:
    """Meta chat models the scenario assistant can switch between. No secret is returned."""

    return {"models": model_catalog(), "default_model": DEFAULT_MODEL, "configured": configured()}


@router.get("/api/v1/parts")
def list_parts() -> dict:
    """The registry of parts Drafty can build, with the inputs each one needs."""

    return {"parts": [part.public() for part in PARTS.values()]}


@router.get("/api/v1/scenarios")
def list_scenarios(request: Request) -> dict:
    owner = current_owner(request)
    found: dict[str, dict] = {}
    root = settings.data_dir / "scenarios"
    if root.exists():
        for path in root.iterdir():
            session_path = path / "session.json"
            if not session_path.is_file():
                continue
            try:
                session = json.loads(session_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                continue
            if session.get("owner_id") != owner:
                continue
            found[session["id"]] = _scenario_summary(session)
    try:
        for row in list_remote_scenarios(current_access_token()):
            state = dict(row.get("state") or {})
            state["id"] = row["id"]
            state["owner_id"] = owner
            state["version"] = row.get("version") or state.get("version")
            state["updated_at"] = row.get("updated_at") or state.get("updated_at")
            state["name"] = row.get("name") or state.get("name")
            found[str(row["id"])] = _scenario_summary(state)
    except Exception:
        if settings.production:
            raise HTTPException(status_code=503, detail="Scenarios could not be loaded.") from None
    rows = sorted(found.values(), key=lambda item: str(item.get("updated_at") or ""), reverse=True)
    return {"scenarios": rows}


def _scenario_summary(session: dict) -> dict:
    inputs = session.get("inputs") or {}
    return {
        "id": session.get("id"),
        "name": session.get("name") or "Untitled",
        "updated_at": session.get("updated_at"),
        "version": session.get("version") or 1,
        "workflow": session.get("workflow"),
        "domain": inputs.get("domain"),
        "studio_approval": session.get("studio_approval"),
    }


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
        "version": 1,
        "analysis": None,
        "comparison": None,
        "ai": "not called",
    }
    _write(session)
    return _public(session)


class DemoBody(BaseModel):
    kind: str
    scenario_id: str | None = None
    bracket: dict | None = None


@router.post("/api/v1/scenarios/demo")
def load_demo(body: DemoBody, request: Request) -> dict:
    """Load a versioned preset with Python calculations. This route does not call a model."""

    owner = current_owner(request)
    session = None
    if body.scenario_id:
        try:
            session = read_scenario(body.scenario_id, owner)
        except HTTPException:
            session = None
    if session is None or _is_user_project(session):
        created = create_scenario(request)
        session = read_scenario(created["id"], owner)
    if body.kind == "classroom":
        record = classroom_record()
    elif body.kind == "bracket":
        record = bracket_record(body.bracket)
    else:
        raise HTTPException(status_code=422, detail="kind must be classroom or bracket.")
    inputs = blank_inputs()
    inputs.update(record["inputs"])
    study = record["study"]
    session["inputs"] = inputs
    session["demo"] = record["demo"]
    session["messages"] = [{"role": "assistant", "text": record["message"]}]
    session["missing"] = study["missing"]
    session["errors"] = study["errors"]
    session["assumptions"] = study["assumptions"]
    session["sources"] = study["sources"]
    session["calculation"] = study["line"]
    session["section"] = study["section"]
    session["beam"] = study["beam"]
    session["model_proposal"] = record["model_proposal"]
    session["verification"] = study["verification"]
    session["engineering"] = record["engineering"]
    session["workflow"] = record["workflow"]
    session["ai"] = "not called"
    session["mode"] = "offline-template"
    session["model"] = None
    session["previous_response_id"] = None
    session["model_questions"] = []
    session["observations"] = []
    session["evidence"] = []
    session["analysis"] = None
    session["comparison"] = None
    session["studio_spec"] = None
    session["studio_approval"] = "pending"
    session["tool_trace"] = [
        {
            "tool": "load_demo",
            "status": "executed",
            "detail": "The preset was applied in Python. No model request was made.",
            "authorization": "user",
            "output": {"kind": body.kind, "version": record["demo"]["version"], "started": False},
        }
    ]
    if body.kind == "bracket":
        session["suggested_faces"] = record.get("suggested_faces")
    session["updated_at"] = datetime.now(UTC).isoformat()
    _write(session)
    return _public(session)


def _is_user_project(session: dict) -> bool:
    if session.get("demo"):
        return False
    if session.get("messages") or session.get("analysis") or session.get("evidence"):
        return True
    if session.get("studio_approval") == "confirmed":
        return True
    inputs = session.get("inputs") or {}
    return any(
        inputs.get(key) not in (None, "") for key in ("span_m", "jurisdiction", "force_n", "supports", "leg_x_m")
    )


@router.get("/api/v1/scenarios/{scenario_id}")
def get_scenario(scenario_id: str, request: Request) -> dict:
    return _public(read_scenario(scenario_id, current_owner(request)))


@router.delete("/api/v1/scenarios/{scenario_id}")
def delete_scenario(scenario_id: str, request: Request) -> dict:
    """Delete a scenario the caller owns, with explicit cleanup of linked resources.

    Deletion policy (idempotent and retryable):
    - Delete: mirrored scenario row; private evidence objects under evidence/{scenario_id}/;
      owned remote jobs for this scenario (results + artifact metadata cascade); private FEM
      storage under {job_id}/; local job directories; local scenario directory.
    - Cancel: active Modal function calls for those owned jobs.
    - Retain: shared content-addressed geometry under geometry/{digest}/ (never removed here).

    Owned job/evidence cleanup runs before the scenario row is removed so a partial failure
    can be retried while the scenario still exists. Missing objects and already-deleted jobs
    count as success.
    """

    owner = current_owner(request)
    session = read_scenario(scenario_id, owner)
    cleanup = _cleanup_scenario_resources(session, owner)
    if cleanup.get("errors"):
        raise HTTPException(
            status_code=503,
            detail={
                "message": "Scenario cleanup was incomplete. Retry the delete.",
                "cleanup": cleanup,
            },
        )
    removed_remote = delete_remote_scenario(scenario_id, current_access_token())
    if settings.production and removed_remote is not True:
        raise HTTPException(status_code=503, detail="The scenario was not deleted.")
    shutil.rmtree(scenario_dir(scenario_id), ignore_errors=True)
    return {
        "id": scenario_id,
        "deleted": True,
        "name": session.get("name") or "Untitled",
        "cleanup": cleanup,
    }


@router.post("/api/v1/scenarios/{scenario_id}/rename")
def rename_scenario(scenario_id: str, body: RenameBody, request: Request) -> dict:
    """Rename a scenario the caller owns. The name is a label only."""

    session = read_scenario(scenario_id, current_owner(request))
    name = body.name.strip()[:120]
    if not name:
        raise HTTPException(status_code=422, detail="The name must not be empty.")
    session["name"] = name
    session["updated_at"] = datetime.now(UTC).isoformat()
    _write(session)
    return _public(session)


@router.post("/api/v1/scenarios/{scenario_id}/turn")
def scenario_turn(scenario_id: str, body: TurnBody, request: Request) -> dict:
    if body.model is not None and body.model not in ALLOWED_MODELS:
        allowed = ", ".join(sorted(ALLOWED_MODELS))
        raise HTTPException(status_code=422, detail=f"Model '{body.model}' is not available. Choose one of: {allowed}.")
    session = read_scenario(scenario_id, current_owner(request))
    merged = _merge_inputs(session, clean_inputs(body.inputs))
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


class FaceBody(BaseModel):
    support_face: str
    load_face: str


_FACES = {"xmin", "xmax", "ymin", "ymax", "zmin", "zmax"}


@router.post("/api/v1/scenarios/{scenario_id}/approve")
def approve_model(scenario_id: str, request: Request) -> dict:
    session = read_scenario(scenario_id, current_owner(request))
    if session.get("studio_approval") == "rejected":
        raise HTTPException(
            status_code=409,
            detail="This proposal was rejected. Confirm the faces again before approval.",
        )
    if not session.get("studio_spec"):
        raise HTTPException(status_code=422, detail="There is no CAD model to approve.")
    session["studio_approval"] = "confirmed"
    session["version"] = int(session.get("version") or 1) + 1
    session["updated_at"] = datetime.now(UTC).isoformat()
    _write(session, snapshot=True)
    return _public(session)


class StudioReturnBody(BaseModel):
    spec: dict[str, Any]


@router.post("/api/v1/scenarios/{scenario_id}/studio-return")
def return_from_studio(scenario_id: str, body: StudioReturnBody, request: Request) -> dict:
    """Studio -> scenario: store the (maybe edited) part and refresh the AI context.

    The spec is the source of truth for what was edited. Scenario inputs are
    rebuilt from it, the study and engineering record are recomputed, and the
    Meta conversation is reset so the next turn reads the new values instead
    of continuing a conversation about the old part. An unchanged spec is a
    no-op: the session is returned as stored.
    """

    session = read_scenario(scenario_id, current_owner(request))
    if session.get("inputs", {}).get("domain") != "mechanical" or not session.get("studio_spec"):
        raise HTTPException(status_code=422, detail="There is no Studio part to return to this scenario.")
    try:
        design = DesignSpec.model_validate(body.spec)
    except ValidationError as exc:
        detail = "; ".join(str(item.get("msg") or item) for item in exc.errors()[:3])
        raise HTTPException(status_code=422, detail=f"The edited part is not valid: {detail}") from exc
    returned = design.model_dump()
    previous = {key: value for key, value in session["studio_spec"].items() if key != "approval"}
    changes = describe_studio_changes(previous, returned)
    if not changes:
        return _public(session)
    inputs = apply_studio_spec(dict(session.get("inputs") or {}), returned)
    if inputs is None:  # The spec validated above, so this only guards the mapping itself.
        raise HTTPException(status_code=422, detail="The edited part could not be mapped back to the scenario.")
    study = evaluate_mechanical(inputs)
    session["inputs"] = inputs
    session["studio_spec"] = {**returned, "approval": "confirmed", "studio_edited": True}
    session["studio_approval"] = "confirmed"
    session["missing"] = study["missing"]
    session["assumptions"] = study["assumptions"]
    session["verification"] = study["verification"]
    session["model_proposal"] = {
        "family": f"parametric {design.kind}, edited in Studio",
        "ready_for_3d_simulation": False,
        "ready_for_beam_elements": False,
        "reason": study["reason"],
    }
    session["engineering"] = build_scenario(
        description="Part edited in Studio",
        inputs=inputs,
        study=study,
        sources=list(session.get("sources") or []),
        evidence_count=len(session.get("evidence") or []),
        analysis=None,
        comparison=None,
    ).model_dump()
    session["workflow"] = workflow_stage(
        domain="mechanical",
        missing=study["missing"],
        searched=False,
        has_model=True,
        has_analysis=False,
        has_comparison=False,
    )
    session["phase"] = "asking" if study["missing"] else "building-model"
    session["tool_trace"] = [
        {
            "tool": "create_supported_cad",
            "status": "updated",
            "detail": "The part was edited in Studio and returned. CalculiX has not started from this return.",
            "authorization": "user",
            "output": {"changes": changes, "started": False},
        }
    ]
    # The old Meta conversation discussed the previous part. Drop its chain so
    # the next turn starts fresh with the updated inputs in the prompt.
    session["previous_response_id"] = None
    session["context_reset"] = True
    messages = list(session.get("messages") or [])
    messages.append({"role": "user", "text": "Returned from Studio with the edited part."})
    messages.append(
        {
            "role": "assistant",
            "text": (
                f"The scenario now uses the part as edited in Studio: {'; '.join(changes)}. "
                "That replaces the earlier proposal, and the saved context was refreshed so the next "
                "reply uses these values. Returning it started no solver; run the analysis in Studio."
            ),
        }
    )
    session["messages"] = messages[-40:]
    session["version"] = int(session.get("version") or 1) + 1
    session["updated_at"] = datetime.now(UTC).isoformat()
    _write(session, snapshot=True)
    return _public(session)


@router.post("/api/v1/scenarios/{scenario_id}/faces")
def confirm_faces(scenario_id: str, body: FaceBody, request: Request) -> dict:
    session = read_scenario(scenario_id, current_owner(request))
    support = body.support_face.strip().lower()
    load_face = body.load_face.strip().lower()
    if support not in _FACES or load_face not in _FACES or support == load_face:
        raise HTTPException(status_code=422, detail="Choose two different bounding-box faces.")
    if session.get("inputs", {}).get("domain") != "mechanical":
        raise HTTPException(status_code=422, detail="Faces apply to a mechanical part, not the classroom beam.")
    inputs = dict(session["inputs"])
    inputs["support_face"] = support
    inputs["load_face"] = load_face
    spec = proposed_studio_spec(inputs)
    if spec is None:
        raise HTTPException(
            status_code=422,
            detail="The part still lacks a dimension, a load, or a library material.",
        )
    study = evaluate_mechanical(inputs)
    session["inputs"] = inputs
    session["studio_spec"] = {**spec, "approval": "pending"}
    session["studio_approval"] = "pending"
    session["missing"] = study["missing"]
    session["assumptions"] = study["assumptions"]
    session["verification"] = study["verification"]
    session["model_proposal"] = {
        "family": f"parametric {spec['kind']}, pending approval",
        "ready_for_3d_simulation": False,
        "ready_for_beam_elements": False,
        "reason": study["reason"],
    }
    engineering = build_scenario(
        description="Confirmed part faces",
        inputs=inputs,
        study=study,
        sources=list(session.get("sources") or []),
        evidence_count=len(session.get("evidence") or []),
        analysis=None,
        comparison=None,
    )
    session["engineering"] = engineering.model_dump()
    session["workflow"] = workflow_stage(
        domain="mechanical",
        missing=study["missing"],
        searched=False,
        has_model=True,
        has_analysis=False,
        has_comparison=False,
    )
    session["tool_trace"] = [
        {
            "tool": "create_supported_cad",
            "status": "proposed",
            "detail": "The user confirmed the faces. CalculiX has not started.",
            "authorization": "user_confirmation",
            "output": {"support": support, "load": load_face, "started": False},
        }
    ]
    messages = list(session.get("messages") or [])
    messages.append({"role": "user", "text": f"Fixed face {support}. Load face {load_face}."})
    messages.append(
        {
            "role": "assistant",
            "text": "Those faces are stored as confirmed. The solid solve still waits for Studio.",
        }
    )
    session["messages"] = messages[-40:]
    session["version"] = int(session.get("version") or 1) + 1
    session["updated_at"] = datetime.now(UTC).isoformat()
    _write(session, snapshot=True)
    return _public(session)


def attach_job(scenario_id: str, owner_id: str, job_id: str, kind: str) -> None:
    session = read_scenario(scenario_id, owner_id)
    jobs = [item for item in (session.get("jobs") or []) if item.get("id") != job_id]
    jobs.append({"id": job_id, "kind": kind})
    session["jobs"] = jobs[-12:]
    session["updated_at"] = datetime.now(UTC).isoformat()
    _write(session)


def assert_scenario_allows_solver(session: dict) -> None:
    """Geometry-only and unresolved parts must not start CalculiX or other solvers."""

    inputs = session.get("inputs") or {}
    system = str(inputs.get("physical_system") or "")
    part = get_part(system)
    if part is not None and (part.domain == "geometry" or part.analysis == ("none",)):
        raise HTTPException(
            status_code=422,
            detail="This scenario is geometry only. No structural solver can be started for it.",
        )


def _cleanup_scenario_resources(session: dict, owner_id: str) -> dict:
    """Cancel Modal, purge owned remote jobs/FEM files, drop local dirs, delete evidence.

    Shared geometry/ cache entries are explicitly retained. Partial failures are listed in
    ``errors`` so the caller can retry without treating missing objects as failure.
    """

    from drafty_api.jobs import job_dir, request_cancel
    from drafty_api.remote import list_remote_jobs_for_scenario, purge_remote_job

    errors: list[str] = []
    evidence_removed = 0
    for item in session.get("evidence") or []:
        media = item.get("media_type")
        ext = EXTENSIONS.get(str(media or ""))
        if not ext:
            continue
        path = f"evidence/{session['id']}/{item['id']}{ext}"
        if delete_private_object(path):
            evidence_removed += 1
        elif settings.supabase_configured:
            errors.append(f"evidence:{path}")

    job_ids: list[str] = []
    seen: set[str] = set()
    for entry in session.get("jobs") or []:
        job_id = str(entry.get("id") or "")
        if job_id and job_id not in seen:
            seen.add(job_id)
            job_ids.append(job_id)
    try:
        for remote_job in list_remote_jobs_for_scenario(str(session["id"]), owner_id):
            job_id = str(remote_job.get("id") or "")
            if job_id and job_id not in seen:
                seen.add(job_id)
                job_ids.append(job_id)
    except Exception as exc:
        errors.append(f"list_jobs:{type(exc).__name__}")

    jobs_cancelled = 0
    jobs_removed = 0
    remote_jobs_purged = 0
    storage_removed = 0
    for job_id in job_ids:
        try:
            request_cancel(job_id, owner_id)
            jobs_cancelled += 1
        except HTTPException:
            pass
        except Exception as exc:
            errors.append(f"cancel:{job_id}:{type(exc).__name__}")
        try:
            report = purge_remote_job(job_id, owner_id)
            if report.get("cancelled"):
                jobs_cancelled += 1
            storage_removed += int(report.get("storage_removed") or 0)
            if report.get("row_deleted"):
                remote_jobs_purged += 1
            if report.get("retryable") and not report.get("row_deleted"):
                errors.append(f"purge:{job_id}:retryable")
            for item in report.get("errors") or []:
                # Geometry refusals must never block scenario deletion; they are policy.
                if str(item).startswith("refused:"):
                    continue
                errors.append(f"purge:{job_id}:{item}")
        except Exception as exc:
            errors.append(f"purge:{job_id}:{type(exc).__name__}")
        try:
            shutil.rmtree(job_dir(job_id), ignore_errors=True)
            jobs_removed += 1
        except Exception as exc:
            errors.append(f"local_job:{job_id}:{type(exc).__name__}")

    return {
        "evidence_objects": evidence_removed,
        "jobs_cancelled": jobs_cancelled,
        "jobs_removed": jobs_removed,
        "remote_jobs_purged": remote_jobs_purged,
        "fem_storage_removed": storage_removed,
        "geometry_cache": "retained",
        "policy": {
            "deleted": [
                "evidence_objects",
                "owned_jobs",
                "results",
                "artifact_metadata",
                "private_fem_files",
                "local_job_dirs",
            ],
            "cancelled": ["active_modal_calls"],
            "retained": ["shared_geometry_cache"],
        },
        "errors": errors,
    }


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
    merged = _merge_inputs(session, clean_inputs(body.inputs))
    system = str(merged.get("physical_system") or session.get("inputs", {}).get("physical_system") or "")
    part = get_part(system)
    if part is not None and (part.domain == "geometry" or part.analysis == ("none",)):
        raise HTTPException(
            status_code=422,
            detail=(
                "This part is geometry only. No structural solver runs for it, "
                "and beam-element analysis is not available."
            ),
        )
    if system and system != "simply_supported_ibeam":
        raise HTTPException(
            status_code=422,
            detail="Euler-Bernoulli beam elements are only available for the classroom I-beam.",
        )
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


@router.get("/api/v1/scenarios/{scenario_id}/geometry/{name}", response_model=None)
def scenario_geometry(scenario_id: str, name: str, request: Request) -> FileResponse | Response:
    """Serve STEP, STL, or GLB from a content-hash cache. No solver runs.

    Authorization is scenario ownership. Identical valid profiles reuse the same immutable
    digest locally and in private storage; Modal runs only on a cache miss in production.
    Production misses return 202 while a durable Modal build is in progress so the browser
    can poll without holding a serverless request open for CadQuery cold starts.
    """

    from drafty_api.geometry_cache import (
        GeometryPending,
        load_or_build_geometry,
        profile_digest,
        read_local_cache,
    )

    owner = current_owner(request)
    session = read_scenario(scenario_id, owner)
    media = GEOMETRY_FILES.get(name)
    if media is None:
        raise HTTPException(status_code=404, detail="Geometry file not found.")
    spec = session.get("geometry_spec") or {}
    if spec.get("kind") != "revolved_profile":
        raise HTTPException(status_code=404, detail="This scenario has no geometry to export.")
    try:
        profile = RevolvedProfile.model_validate(spec.get("profile"))
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail="The stored profile is not valid.") from exc
    filename = f"{profile.name}{Path(name).suffix}"
    digest = profile_digest(profile)
    try:
        files, hit = load_or_build_geometry(profile, owner)
    except GeometryPending as pending:
        return Response(
            content=json.dumps(
                {
                    "status": pending.status,
                    "digest": pending.digest,
                    "retryable": True,
                    "message": "Geometry is building on Modal. Poll this URL again shortly.",
                }
            ),
            status_code=202,
            media_type="application/json",
            headers={
                "X-Drafty-Geometry-Digest": pending.digest,
                "X-Drafty-Geometry-Cache": "pending",
                "Retry-After": "2",
            },
        )
    data = files[name]
    if len(data) > MAX_ARTIFACT_BYTES:
        raise HTTPException(status_code=502, detail="Geometry file exceeds the size limit.")
    headers = {
        "X-Drafty-Geometry-Digest": digest,
        "X-Drafty-Geometry-Cache": "hit" if hit else "miss",
    }
    if not settings.production and read_local_cache(digest) is not None:
        from drafty_api.geometry_cache import geometry_dir

        return FileResponse(
            geometry_dir(digest) / name,
            media_type=media,
            filename=filename,
            headers=headers,
        )
    return Response(
        content=data,
        media_type=media,
        headers={
            **headers,
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(data)),
        },
    )


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
    stored = upload_private_object(
        f"evidence/{scenario_id}/{evidence_id}{EXTENSIONS[media]}",
        data,
        media,
    )
    if settings.production and not stored:
        raise HTTPException(status_code=503, detail="The image was not stored.")
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
    item = next((entry for entry in session["evidence"] if entry["id"] == evidence_id), None)
    if item is None:
        raise HTTPException(status_code=404, detail="Image not found.")
    directory = scenario_dir(scenario_id) / "evidence"
    for path in directory.glob(f"{evidence_id}.*"):
        path.unlink(missing_ok=True)
    ext = EXTENSIONS.get(str(item.get("media_type") or ""))
    if ext:
        delete_private_object(f"evidence/{scenario_id}/{evidence_id}{ext}")
    session["evidence"] = [entry for entry in session["evidence"] if entry["id"] != evidence_id]
    session["updated_at"] = datetime.now(UTC).isoformat()
    _write(session)
    return _public(session)


@router.get("/api/v1/scenarios/{scenario_id}/evidence/{evidence_id}", response_model=None)
def get_evidence(scenario_id: str, evidence_id: str, request: Request) -> FileResponse | RedirectResponse:
    session = read_scenario(scenario_id, current_owner(request))
    _evidence_id(evidence_id)
    item = next((entry for entry in session["evidence"] if entry["id"] == evidence_id), None)
    if item is None:
        raise HTTPException(status_code=404, detail="Image not found.")
    path = scenario_dir(scenario_id) / "evidence" / f"{evidence_id}{EXTENSIONS[item['media_type']]}"
    if not path.exists():
        signed = signed_object_url(
            f"evidence/{scenario_id}/{evidence_id}{EXTENSIONS[item['media_type']]}",
            120,
        )
        if signed:
            return RedirectResponse(signed)
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
        if path.exists():
            data = path.read_bytes()
        else:
            data = download_private_object(f"evidence/{session['id']}/{item['id']}{EXTENSIONS[item['media_type']]}")
            if data is None:
                continue
        if total + len(data) > MAX_VISION_BYTES:
            withheld = True
            break
        total += len(data)
        encoded = base64.b64encode(data).decode("ascii")
        urls.append(f"data:{item['media_type']};base64,{encoded}")
    return urls, withheld
